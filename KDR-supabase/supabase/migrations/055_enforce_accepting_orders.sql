-- ============================================================
-- 055: Enforce is_accepting_orders server-side + consolidate
--      rpc_checkout overloads
--
-- Problem 1 — busy restaurants could still sell:
--   `restaurants.is_accepting_orders` was only cosmetic. The
--   mobile app showed "مشغول حالياً" but rpc_add_to_cart and
--   rpc_checkout accepted the order anyway. Both now reject with
--   the token 'not_accepting_orders' (the app maps it to a clean
--   Arabic message), and _build_cart_response exposes the live
--   flags per cart item so the cart screen can disable checkout
--   without an extra round-trip.
--
-- Problem 2 — two rpc_checkout overloads live in prod:
--   Migration 053 recreated rpc_checkout with 7 params but only
--   dropped the 7-param signature, leaving 047's 8-param version
--   (p_alternate_phone + OLD proportional commission formula)
--   alive. PostgREST cannot disambiguate most calls between the
--   two, and any call that did resolve to the 8-param one used
--   the wrong commission math. No orders were placed since 053
--   was applied (online ordering is still disabled), so nothing
--   needs backfilling. Both overloads are dropped and ONE
--   canonical function is created: 053's voucher-absorbed-by-
--   commission body + 047's free-form alternate phone + the new
--   accepting-orders guard.
-- ============================================================

-- ── 1) _build_cart_response v2 — expose restaurant flags ─────
create or replace function public._build_cart_response(p_cart_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'id', p_cart_id,
    'user_id', p_user_id,
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', ci.id,
         'menu_item_id', ci.menu_item_id,
         'quantity', ci.quantity,
         'special_instructions', ci.special_instructions,
         'menu_item', jsonb_build_object(
           'id', mi.id, 'name_ar', mi.name_ar, 'name_en', mi.name_en,
           'price', mi.price, 'image_url', mi.image_url,
           'restaurant_id', mi.restaurant_id,
           'restaurant_name_ar', r.name_ar,
           'restaurant_name_en', r.name_en,
           'restaurant_accepts_online_orders', r.accepts_online_orders,
           'restaurant_is_accepting_orders', r.is_accepting_orders,
           'is_available', mi.is_available
         ),
         'item_total', ci.quantity * mi.price
       ))
       from cart_items ci
       join menu_items mi on mi.id = ci.menu_item_id
       join restaurants r on r.id = mi.restaurant_id
       where ci.cart_id = p_cart_id),
      '[]'::jsonb
    ),
    'total_price', coalesce(
      (select sum(ci.quantity * mi.price)
       from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
       where ci.cart_id = p_cart_id), 0)
  );
end; $$;

revoke execute on function public._build_cart_response(uuid, uuid) from anon, authenticated, public;


-- ── 2) rpc_add_to_cart v2 — reject busy/offline restaurants ──
create or replace function public.rpc_add_to_cart(
  p_menu_item_id          uuid,
  p_quantity              integer default 1,
  p_special_instructions  text    default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid              uuid := auth.uid();
  v_cart_id          uuid;
  v_mi               record;
  v_rest             record;
  v_first_rest_id    uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select * into v_mi from menu_items where id = p_menu_item_id and is_available = true;
  if not found then
    return jsonb_build_object('error', 'Menu item not found or unavailable');
  end if;

  -- A restaurant that turned off online orders or flipped itself to
  -- "busy" must not receive new cart items. The mobile app blocks this
  -- in the UI too, but the flag can change while the menu is open —
  -- the server is the source of truth.
  select accepts_online_orders, is_accepting_orders
  into v_rest from restaurants where id = v_mi.restaurant_id;
  if not coalesce(v_rest.accepts_online_orders, false)
     or not coalesce(v_rest.is_accepting_orders, false) then
    return jsonb_build_object('error', 'not_accepting_orders');
  end if;

  if p_quantity < 1 then
    return jsonb_build_object('error', 'Quantity must be at least 1');
  end if;

  insert into carts (user_id) values (v_uid) on conflict (user_id) do nothing;
  select id into v_cart_id from carts where user_id = v_uid;

  -- Enforce single-restaurant cart
  select mi.restaurant_id into v_first_rest_id
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id limit 1;

  if v_first_rest_id is not null and v_first_rest_id <> v_mi.restaurant_id then
    return jsonb_build_object(
      'error', 'You can only order from one restaurant at a time. Clear your cart first.',
      'conflicting_restaurant_id', v_first_rest_id
    );
  end if;

  insert into cart_items (cart_id, menu_item_id, quantity, special_instructions)
  values (v_cart_id, p_menu_item_id, p_quantity, p_special_instructions)
  on conflict (cart_id, menu_item_id) do update
    set quantity = cart_items.quantity + excluded.quantity,
        special_instructions = coalesce(excluded.special_instructions, cart_items.special_instructions);

  return public._build_cart_response(v_cart_id, v_uid);
end; $$;


-- ── 3) rpc_checkout v5 — single canonical overload ───────────
drop function if exists public.rpc_checkout(uuid, uuid, text, text, text, text, text);
drop function if exists public.rpc_checkout(uuid, uuid, text, text, text, text, text, text);

create function public.rpc_checkout(
  p_delivery_address_id uuid    default null,
  p_branch_id           uuid    default null,
  p_contact_phone       text    default null,
  p_notes               text    default null,
  p_voucher_code        text    default null,
  p_order_type          text    default 'delivery',
  p_delivery_address    text    default null,   -- legacy fallback
  p_alternate_phone     text    default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid    := auth.uid();
  v_cart_id      uuid;
  v_rest_id      uuid;
  v_rest         record;
  v_subtotal     numeric(10,2) := 0;
  v_discount     numeric(10,2) := 0;
  v_total        numeric(10,2);
  v_voucher      record;
  v_voucher_id   uuid    := null;
  v_order_id     uuid;
  v_order_type   public.order_type;
  v_comm_pct     numeric(5,2) := 0;
  v_comm_gross   numeric(10,2);
  v_comm_amount  numeric(10,2);
  v_platform_share numeric(10,2);
  v_rest_share   numeric(10,2);
  v_rest_revenue numeric(10,2);

  v_branch_id    uuid;
  v_branch_count integer;
  v_branch_lat   double precision;
  v_branch_lng   double precision;

  v_addr_id      uuid;
  v_addr_text    text;
  v_addr_lat     double precision;
  v_addr_lng     double precision;

  v_fee_row      record;
  v_delivery_fee numeric(10,2) := 0;
  v_distance_km  numeric(6,2)  := null;

  v_alt_phone    text;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  begin
    v_order_type := p_order_type::public.order_type;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid order type: ' || p_order_type);
  end;

  if p_contact_phone is null or p_contact_phone = '' then
    return jsonb_build_object('error', 'Contact phone is required');
  end if;

  -- Free-form alt: trim, null out empty strings, accept as-is (047 rule).
  v_alt_phone := nullif(trim(coalesce(p_alternate_phone, '')), '');

  select id into v_cart_id from carts where user_id = v_uid;
  if v_cart_id is null or not exists (select 1 from cart_items where cart_id = v_cart_id) then
    return jsonb_build_object('error', 'Cart is empty');
  end if;

  select mi.restaurant_id, sum(ci.quantity * mi.price)
  into v_rest_id, v_subtotal
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id
  group by mi.restaurant_id;

  -- Busy/offline restaurants cannot receive orders. Checked before any
  -- side effect (voucher counter, order insert) so a rejection is clean.
  select accepts_online_orders, is_accepting_orders
  into v_rest from restaurants where id = v_rest_id;
  if not coalesce(v_rest.accepts_online_orders, false)
     or not coalesce(v_rest.is_accepting_orders, false) then
    return jsonb_build_object('error', 'not_accepting_orders');
  end if;

  -- ── Delivery-specific validation + fee computation ──────────
  if v_order_type = 'delivery' then
    if p_branch_id is not null then
      select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
      from branches where id = p_branch_id and restaurant_id = v_rest_id;
      if v_branch_id is null then
        return jsonb_build_object('error', 'Invalid branch for this restaurant');
      end if;
    else
      select count(*) into v_branch_count from branches where restaurant_id = v_rest_id;
      if v_branch_count = 1 then
        select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
        from branches where restaurant_id = v_rest_id;
      else
        return jsonb_build_object('error', 'branch_id is required when the restaurant has multiple branches');
      end if;
    end if;

    if p_delivery_address_id is not null then
      select id, address_ar, lat, lng
      into v_addr_id, v_addr_text, v_addr_lat, v_addr_lng
      from user_addresses where id = p_delivery_address_id and user_id = v_uid;
      if v_addr_id is null then
        return jsonb_build_object('error', 'Address not found or access denied');
      end if;
    elsif p_delivery_address is not null and p_delivery_address <> '' then
      v_addr_text := p_delivery_address;
    else
      return jsonb_build_object('error', 'Delivery address is required for delivery orders');
    end if;

    if v_branch_lat is not null and v_branch_lng is not null
       and v_addr_id is not null and v_addr_lat is not null and v_addr_lng is not null then
      select * into v_fee_row from compute_delivery_fee(v_branch_id, v_addr_id);
      if v_fee_row.needs_pin then
        return jsonb_build_object('error', 'address_needs_pin');
      end if;
      if not v_fee_row.in_range then
        return jsonb_build_object('error', 'address_out_of_range');
      end if;
      v_delivery_fee := v_fee_row.fee;
      v_distance_km  := v_fee_row.distance_km;
    else
      return jsonb_build_object('error', 'address_needs_pin');
    end if;
  end if;

  -- ── Voucher ─────────────────────────────────────────────────
  if p_voucher_code is not null and p_voucher_code <> '' then
    select * into v_voucher
    from vouchers
    where code = p_voucher_code and restaurant_id = v_rest_id
      and is_active = true and valid_from <= now() and valid_to >= now();

    if not found then
      return jsonb_build_object('error', 'Invalid or expired voucher code');
    end if;
    if v_voucher.usage_limit is not null and v_voucher.used_count >= v_voucher.usage_limit then
      return jsonb_build_object('error', 'Voucher usage limit reached');
    end if;
    if v_subtotal < v_voucher.min_order_amount then
      return jsonb_build_object('error',
        format('Minimum order amount for this voucher is %s', v_voucher.min_order_amount));
    end if;

    v_voucher_id := v_voucher.id;
    v_discount := round(
      case when v_voucher.discount_type = 'percentage'
        then (v_subtotal * v_voucher.discount_value) / 100
        else v_voucher.discount_value end,
      2);
    -- Never let a voucher discount exceed the food value.
    v_discount := least(v_discount, v_subtotal);

    update vouchers set used_count = used_count + 1 where id = v_voucher_id;
  end if;

  v_total := greatest(v_subtotal - v_discount, 0) + v_delivery_fee;

  -- ── Commission split (053 formula: platform absorbs first) ──
  select commission_percentage into v_comm_pct from restaurants where id = v_rest_id;
  v_comm_pct       := coalesce(v_comm_pct, 0);
  v_comm_gross     := round(v_subtotal * v_comm_pct / 100, 2);
  v_platform_share := least(v_discount, v_comm_gross);
  v_rest_share     := greatest(v_discount - v_comm_gross, 0);
  v_comm_amount    := v_comm_gross - v_platform_share;
  v_rest_revenue   := greatest(v_subtotal - v_discount - v_comm_amount, 0);

  insert into orders (
    user_id, restaurant_id, status, order_type,
    delivery_address, contact_phone, alternate_phone, notes,
    subtotal, delivery_fee, discount, total_amount,
    commission_percentage, commission_gross, commission_amount,
    discount_platform_share, discount_restaurant_share,
    restaurant_revenue,
    voucher_id,
    branch_id, delivery_address_id,
    branch_lat, branch_lng,
    delivery_lat, delivery_lng,
    delivery_distance_km
  ) values (
    v_uid, v_rest_id, 'pending', v_order_type,
    case when v_order_type = 'delivery' then v_addr_text else null end,
    p_contact_phone, v_alt_phone, p_notes,
    v_subtotal, v_delivery_fee, v_discount, v_total,
    v_comm_pct, v_comm_gross, v_comm_amount,
    v_platform_share, v_rest_share,
    v_rest_revenue,
    v_voucher_id,
    v_branch_id, v_addr_id,
    v_branch_lat, v_branch_lng,
    v_addr_lat, v_addr_lng,
    v_distance_km
  )
  returning id into v_order_id;

  insert into order_items (order_id, menu_item_id, item_name_en, item_name_ar, price, quantity, special_instructions)
  select v_order_id, ci.menu_item_id, mi.name_en, mi.name_ar, mi.price, ci.quantity, ci.special_instructions
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id;

  delete from cart_items where cart_id = v_cart_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'orders', v_order_id::text,
    jsonb_build_object(
      'total',                     v_total,
      'restaurant_id',             v_rest_id,
      'order_type',                v_order_type,
      'branch_id',                 v_branch_id,
      'delivery_fee',              v_delivery_fee,
      'distance_km',               v_distance_km,
      'commission_gross',          v_comm_gross,
      'commission_amount',         v_comm_amount,
      'discount_platform_share',   v_platform_share,
      'discount_restaurant_share', v_rest_share
    ));

  return public.rpc_get_order_detail(v_order_id);
end; $$;

grant execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text, text) to authenticated;
