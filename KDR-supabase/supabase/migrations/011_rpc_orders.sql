-- ============================================================
-- 011: Checkout + Orders RPC Functions
-- ============================================================

-- ── rpc_get_order_detail ──────────────────────────────────────
create or replace function public.rpc_get_order_detail(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_o   jsonb;
begin
  select jsonb_build_object(
    'id', o.id, 'status', o.status,
    'delivery_address', o.delivery_address,
    'contact_phone', o.contact_phone,
    'notes', o.notes,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee,
    'discount', o.discount, 'total_amount', o.total_amount,
    'restaurant_rating', o.restaurant_rating,
    'restaurant_review', o.restaurant_review,
    'rated_at', o.rated_at,
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'restaurant', jsonb_build_object(
      'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'logo_url', r.logo_url, 'estimated_delivery_time', r.estimated_delivery_time
    ),
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', oi.id,
         'menu_item_id', oi.menu_item_id,
         'item_name_ar', oi.item_name_ar,
         'item_name_en', oi.item_name_en,
         'price', oi.price,
         'quantity', oi.quantity,
         'special_instructions', oi.special_instructions,
         'subtotal', oi.quantity * oi.price
       ))
       from order_items oi where oi.order_id = o.id),
      '[]'::jsonb
    )
  ) into v_o
  from orders o join restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id
    and (o.user_id = v_uid
         or o.restaurant_id = public.get_my_restaurant_id()
         or public.is_admin());

  return coalesce(v_o, jsonb_build_object('error', 'Order not found or access denied'));
end; $$;

-- ── rpc_checkout ──────────────────────────────────────────────
create or replace function public.rpc_checkout(
  p_delivery_address text,
  p_contact_phone    text,
  p_notes            text  default null,
  p_voucher_code     text  default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid    := auth.uid();
  v_cart_id     uuid;
  v_rest_id     uuid;
  v_subtotal    numeric(10,2) := 0;
  v_del_fee     numeric(6,2);
  v_discount    numeric(10,2) := 0;
  v_total       numeric(10,2);
  v_voucher     record;
  v_order_id    uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
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

  select delivery_fee into v_del_fee from restaurants where id = v_rest_id;
  v_del_fee := coalesce(v_del_fee, 0);

  -- Validate voucher
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

    v_discount := case when v_voucher.discount_type = 'percentage'
      then (v_subtotal * v_voucher.discount_value) / 100
      else v_voucher.discount_value end;

    update vouchers set used_count = used_count + 1 where id = v_voucher.id;
  end if;

  v_total := greatest(v_subtotal + v_del_fee - v_discount, 0);

  -- Create order
  insert into orders (
    user_id, restaurant_id, status,
    delivery_address, contact_phone, notes,
    subtotal, delivery_fee, discount, total_amount,
    voucher_id
  ) values (
    v_uid, v_rest_id, 'pending',
    p_delivery_address, p_contact_phone, p_notes,
    v_subtotal, v_del_fee, v_discount, v_total,
    case when v_voucher.id is not null then v_voucher.id else null end
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
    jsonb_build_object('total', v_total, 'restaurant_id', v_rest_id));

  return public.rpc_get_order_detail(v_order_id);
end; $$;

-- ── rpc_get_my_orders ─────────────────────────────────────────
create or replace function public.rpc_get_my_orders(
  p_status    text    default null,
  p_page      integer default 1,
  p_page_size integer default 10
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid    := auth.uid();
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select count(*) into v_total from orders
  where user_id = v_uid
    and (p_status is null or status::text = p_status);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select
      o.id, o.status, o.total_amount, o.subtotal, o.delivery_fee, o.discount,
      o.restaurant_rating, o.rated_at, o.created_at, o.updated_at,
      jsonb_build_object('id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en, 'logo_url', r.logo_url) as restaurant,
      (select count(*) from order_items oi where oi.order_id = o.id) as items_count
    from orders o join restaurants r on r.id = o.restaurant_id
    where o.user_id = v_uid
      and (p_status is null or o.status::text = p_status)
    order by o.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size))
  );
end; $$;

-- ── rpc_update_order_status ───────────────────────────────────
create or replace function public.rpc_update_order_status(
  p_order_id uuid,
  p_status   text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_valid   order_status[];
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  if not (public.is_restaurant_owner() or public.is_admin()) then
    return jsonb_build_object('error', 'Access denied');
  end if;

  -- Validate status value via cast (will raise if invalid)
  begin
    perform p_status::order_status;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid status value');
  end;

  if public.is_restaurant_owner() then
    if not exists (select 1 from orders where id = p_order_id and restaurant_id = v_rest_id) then
      return jsonb_build_object('error', 'Order not found or access denied');
    end if;
  end if;

  update orders set status = p_status::order_status, updated_at = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text, jsonb_build_object('status', p_status));

  return jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
end; $$;

-- ── rpc_rate_order ────────────────────────────────────────────
create or replace function public.rpc_rate_order(
  p_order_id uuid,
  p_rating   integer,
  p_review   text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select * into v_order from orders where id = p_order_id and user_id = v_uid;
  if not found then
    return jsonb_build_object('error', 'Order not found');
  end if;

  if v_order.status <> 'delivered' then
    return jsonb_build_object('error', 'You can only rate a delivered order');
  end if;

  if v_order.restaurant_rating is not null then
    return jsonb_build_object('error', 'You have already rated this order');
  end if;

  if p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('error', 'Rating must be between 1 and 5');
  end if;

  update orders set
    restaurant_rating = p_rating,
    restaurant_review = p_review,
    rated_at = now(), updated_at = now()
  where id = p_order_id;

  return public.rpc_get_order_detail(p_order_id);
end; $$;
