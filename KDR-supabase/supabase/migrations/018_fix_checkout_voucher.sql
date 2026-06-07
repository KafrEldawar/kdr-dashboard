-- ============================================================
-- 018: Fix rpc_checkout — error 55000 when no voucher provided
-- Root cause: accessing v_voucher.id (record type, never assigned)
-- raises PL/pgSQL "record variable is not assigned" even when
-- p_voucher_code is null. Fix: use a dedicated v_voucher_id uuid.
-- ============================================================

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
  v_voucher_id  uuid    := null;
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

  -- Validate voucher (only when code provided)
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
    v_voucher_id
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
