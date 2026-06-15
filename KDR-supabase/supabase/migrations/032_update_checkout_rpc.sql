-- ============================================================
-- 032: rpc_checkout v3 — saved-address + branch + dynamic fee
--
-- Changes vs 025:
--   - Adds   p_delivery_address_id (uuid) and p_branch_id (uuid).
--   - Keeps  p_delivery_address (text) ONLY as a fallback (legacy
--            client builds during the rollout). Once all clients
--            ship the new flow, the text param can be dropped.
--   - For delivery orders: server resolves branch_id (auto when
--            the restaurant has a single branch), looks up the
--            saved address, calls compute_delivery_fee, and
--            REJECTS the request if the address has no pin or is
--            out of range. The client-supplied delivery_fee is
--            never trusted.
--   - For pickup orders: fee = 0, address optional.
--   - Snapshots branch + delivery lat/lng/distance onto the order
--            so future address edits don't rewrite history.
-- ============================================================

-- Drop any previous signature (this migration is rerunnable).
drop function if exists public.rpc_checkout(text, text, text, text, text);
drop function if exists public.rpc_checkout(text, text, text, text);
drop function if exists public.rpc_checkout(uuid, uuid, text, text, text, text, text);

create function public.rpc_checkout(
  p_delivery_address_id uuid    default null,
  p_branch_id           uuid    default null,
  p_contact_phone       text    default null,
  p_notes               text    default null,
  p_voucher_code        text    default null,
  p_order_type          text    default 'delivery',
  p_delivery_address    text    default null   -- legacy fallback
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid    := auth.uid();
  v_cart_id      uuid;
  v_rest_id      uuid;
  v_subtotal     numeric(10,2) := 0;
  v_discount     numeric(10,2) := 0;
  v_total        numeric(10,2);
  v_voucher      record;
  v_voucher_id   uuid    := null;
  v_order_id     uuid;
  v_order_type   public.order_type;
  v_comm_pct     numeric(5,2) := 0;
  v_comm_amount  numeric(10,2);
  v_net          numeric(10,2);

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

  select id into v_cart_id from carts where user_id = v_uid;
  if v_cart_id is null or not exists (select 1 from cart_items where cart_id = v_cart_id) then
    return jsonb_build_object('error', 'Cart is empty');
  end if;

  -- Subtotal + restaurant from cart
  select mi.restaurant_id, sum(ci.quantity * mi.price)
  into v_rest_id, v_subtotal
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id
  group by mi.restaurant_id;

  -- ── Delivery-specific validation + fee computation ──────────
  if v_order_type = 'delivery' then
    -- Resolve branch
    if p_branch_id is not null then
      select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
      from branches where id = p_branch_id and restaurant_id = v_rest_id;
      if v_branch_id is null then
        return jsonb_build_object('error', 'Invalid branch for this restaurant');
      end if;
    else
      -- Auto-pick when the restaurant has exactly one branch
      select count(*) into v_branch_count from branches where restaurant_id = v_rest_id;
      if v_branch_count = 1 then
        select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
        from branches where restaurant_id = v_rest_id;
      else
        return jsonb_build_object('error', 'branch_id is required when the restaurant has multiple branches');
      end if;
    end if;

    -- Resolve delivery address
    if p_delivery_address_id is not null then
      select id, address_ar, lat, lng
      into v_addr_id, v_addr_text, v_addr_lat, v_addr_lng
      from user_addresses where id = p_delivery_address_id and user_id = v_uid;
      if v_addr_id is null then
        return jsonb_build_object('error', 'Address not found or access denied');
      end if;
    elsif p_delivery_address is not null and p_delivery_address <> '' then
      -- Legacy: only text address (no pin) — no fee can be computed
      v_addr_text := p_delivery_address;
    else
      return jsonb_build_object('error', 'Delivery address is required for delivery orders');
    end if;

    -- Compute the fee canonically when we have both pins
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
      -- Legacy address (no lat/lng) or branch without pin — block.
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
    v_discount := case when v_voucher.discount_type = 'percentage'
      then (v_subtotal * v_voucher.discount_value) / 100
      else v_voucher.discount_value end;

    update vouchers set used_count = used_count + 1 where id = v_voucher_id;
  end if;

  v_total := greatest(v_subtotal - v_discount, 0) + v_delivery_fee;

  -- Commission snapshot (base: food value net of discount)
  select commission_percentage into v_comm_pct from restaurants where id = v_rest_id;
  v_comm_pct    := coalesce(v_comm_pct, 0);
  v_net         := greatest(v_subtotal - v_discount, 0);
  v_comm_amount := round(v_net * v_comm_pct / 100, 2);

  insert into orders (
    user_id, restaurant_id, status, order_type,
    delivery_address, contact_phone, notes,
    subtotal, delivery_fee, discount, total_amount,
    commission_percentage, commission_amount, restaurant_revenue,
    voucher_id,
    branch_id, delivery_address_id,
    branch_lat, branch_lng,
    delivery_lat, delivery_lng,
    delivery_distance_km
  ) values (
    v_uid, v_rest_id, 'pending', v_order_type,
    case when v_order_type = 'delivery' then v_addr_text else null end,
    p_contact_phone, p_notes,
    v_subtotal, v_delivery_fee, v_discount, v_total,
    v_comm_pct, v_comm_amount, v_net - v_comm_amount,
    v_voucher_id,
    v_branch_id, v_addr_id,
    v_branch_lat, v_branch_lng,
    v_addr_lat, v_addr_lng,
    v_distance_km
  )
  returning id into v_order_id;

  -- Snapshot cart items into order_items
  insert into order_items (order_id, menu_item_id, item_name_en, item_name_ar, price, quantity, special_instructions)
  select v_order_id, ci.menu_item_id, mi.name_en, mi.name_ar, mi.price, ci.quantity, ci.special_instructions
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id;

  -- Clear cart
  delete from cart_items where cart_id = v_cart_id;

  -- Audit
  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'orders', v_order_id::text,
    jsonb_build_object(
      'total',         v_total,
      'restaurant_id', v_rest_id,
      'order_type',    v_order_type,
      'branch_id',     v_branch_id,
      'delivery_fee',  v_delivery_fee,
      'distance_km',   v_distance_km
    ));

  return public.rpc_get_order_detail(v_order_id);
end; $$;

grant execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text) to authenticated;
