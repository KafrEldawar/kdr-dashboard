-- ============================================================
-- 025: Order lifecycle RPCs — order types, accept/reject with
--      prep time, customer cancel, commission snapshot,
--      removal of restaurant delivery_fee / min_order_amount.
-- ============================================================

-- ── rpc_get_order_detail (v2: lifecycle + driver fields) ──────
create or replace function public.rpc_get_order_detail(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_o   jsonb;
begin
  select jsonb_build_object(
    'id', o.id, 'status', o.status,
    'order_type', o.order_type,
    'delivery_address', o.delivery_address,
    'contact_phone', o.contact_phone,
    'notes', o.notes,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee,
    'discount', o.discount, 'total_amount', o.total_amount,
    'accepted_at', o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'rejection_reason', o.rejection_reason,
    'picked_up_at', o.picked_up_at,
    'delivered_at', o.delivered_at,
    'restaurant_rating', o.restaurant_rating,
    'restaurant_review', o.restaurant_review,
    'rated_at', o.rated_at,
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'restaurant', jsonb_build_object(
      'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'logo_url', r.logo_url, 'estimated_delivery_time', r.estimated_delivery_time
    ),
    'driver', case when o.driver_id is null then null else (
      select jsonb_build_object('id', d.id, 'full_name', d.full_name, 'phone', d.phone)
      from profiles d where d.id = o.driver_id
    ) end,
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
         or o.driver_id = v_uid
         or o.restaurant_id = public.get_my_restaurant_id()
         or public.is_admin());

  return coalesce(v_o, jsonb_build_object('error', 'Order not found or access denied'));
end; $$;

-- ── rpc_checkout (v2: order type + commission, no restaurant fee)
-- Signature changes (added p_order_type) → drop the old function
-- first so PostgREST has a single unambiguous candidate.
drop function if exists public.rpc_checkout(text, text, text, text);

create function public.rpc_checkout(
  p_delivery_address text default null,
  p_contact_phone    text default null,
  p_notes            text default null,
  p_voucher_code     text default null,
  p_order_type       text default 'delivery'
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
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  begin
    v_order_type := p_order_type::public.order_type;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid order type: ' || p_order_type);
  end;

  if v_order_type = 'delivery' and (p_delivery_address is null or p_delivery_address = '') then
    return jsonb_build_object('error', 'Delivery address is required for delivery orders');
  end if;

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

  -- Delivery fee is 0 for now (location-based fees come later);
  -- platform earns via restaurant commission instead.
  v_total := greatest(v_subtotal - v_discount, 0);

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
    voucher_id
  ) values (
    v_uid, v_rest_id, 'pending', v_order_type,
    case when v_order_type = 'delivery' then p_delivery_address else null end,
    p_contact_phone, p_notes,
    v_subtotal, 0, v_discount, v_total,
    v_comm_pct, v_comm_amount, v_net - v_comm_amount,
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
    jsonb_build_object('total', v_total, 'restaurant_id', v_rest_id, 'order_type', v_order_type));

  return public.rpc_get_order_detail(v_order_id);
end; $$;

-- ── rpc_get_my_orders (v2: lifecycle fields) ──────────────────
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
      o.id, o.status, o.order_type, o.total_amount, o.subtotal, o.delivery_fee, o.discount,
      o.accepted_at, o.estimated_preparation_minutes, o.rejection_reason,
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

-- ── owner order json helper (shared response shape) ───────────
create or replace function public.owner_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',               o.id,
    'status',           o.status,
    'order_type',       o.order_type,
    'total_amount',     o.total_amount,
    'subtotal',         o.subtotal,
    'delivery_fee',     o.delivery_fee,
    'discount',         o.discount,
    'delivery_address', o.delivery_address,
    'contact_phone',    o.contact_phone,
    'notes',            o.notes,
    'accepted_at',      o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'rejection_reason', o.rejection_reason,
    'picked_up_at',     o.picked_up_at,
    'delivered_at',     o.delivered_at,
    'created_at',       o.created_at,
    'updated_at',       o.updated_at,
    'items_count',      (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',         jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
    'driver', case when o.driver_id is null then null else (
      select jsonb_build_object('id', d.id, 'full_name', d.full_name, 'phone', d.phone)
      from profiles d where d.id = o.driver_id
    ) end,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                   oi.id,
          'name_ar',              oi.item_name_ar,
          'name_en',              oi.item_name_en,
          'price',                oi.price,
          'quantity',             oi.quantity,
          'special_instructions', oi.special_instructions
        )
      ), '[]'::jsonb)
      from order_items oi where oi.order_id = o.id
    )
  )
  from orders o join profiles p on p.id = o.user_id
  where o.id = p_order_id;
$$;

revoke execute on function public.owner_order_json(uuid) from anon, public;

-- ── rpc_owner_get_orders (v2: lifecycle + driver fields) ──────
create or replace function public.rpc_owner_get_orders(
  p_status    text    default null,
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rest_id uuid    := public.get_my_restaurant_id();
  v_offset  integer := (p_page - 1) * p_page_size;
  v_total   integer;
  v_data    jsonb;
begin
  if v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  select count(*) into v_total from orders
  where restaurant_id = v_rest_id
    and (p_status is null or status::text = p_status);

  select coalesce(jsonb_agg(public.owner_order_json(o.id) order by o.created_at desc), '[]'::jsonb)
  into v_data
  from (
    select id, created_at from orders
    where restaurant_id = v_rest_id
      and (p_status is null or status::text = p_status)
    order by created_at desc
    limit p_page_size offset v_offset
  ) o;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page,
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── rpc_owner_accept_order ────────────────────────────────────
create or replace function public.rpc_owner_accept_order(
  p_order_id     uuid,
  p_prep_minutes integer
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_order   record;
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  if p_prep_minutes is null or p_prep_minutes < 5 or p_prep_minutes > 180 then
    return jsonb_build_object('error', 'Preparation time must be between 5 and 180 minutes');
  end if;

  select * into v_order from orders
  where id = p_order_id and restaurant_id = v_rest_id;

  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  if v_order.status <> 'pending' then
    return jsonb_build_object('error', 'Only pending orders can be accepted');
  end if;

  update orders set
    status = 'preparing',
    accepted_at = now(),
    estimated_preparation_minutes = p_prep_minutes,
    updated_at = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('status', 'preparing', 'prep_minutes', p_prep_minutes));

  perform public.notify_order_event('status_change', p_order_id);
  if v_order.order_type = 'delivery' then
    perform public.notify_order_event('order_available', p_order_id);
  end if;

  return public.owner_order_json(p_order_id);
end; $$;

-- ── rpc_owner_reject_order ────────────────────────────────────
create or replace function public.rpc_owner_reject_order(
  p_order_id uuid,
  p_reason   text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_order   record;
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('error', 'Rejection reason is required');
  end if;

  select * into v_order from orders
  where id = p_order_id and restaurant_id = v_rest_id;

  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  if v_order.status <> 'pending' then
    return jsonb_build_object('error', 'Only pending orders can be rejected');
  end if;

  update orders set
    status = 'rejected',
    rejection_reason = p_reason,
    updated_at = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('status', 'rejected', 'reason', p_reason));

  perform public.notify_order_event('status_change', p_order_id);

  return public.owner_order_json(p_order_id);
end; $$;

-- ── rpc_customer_cancel_order ─────────────────────────────────
create or replace function public.rpc_customer_cancel_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select * into v_order from orders
  where id = p_order_id and user_id = v_uid;

  if not found then
    return jsonb_build_object('error', 'Order not found');
  end if;

  if v_order.status <> 'pending' then
    return jsonb_build_object('error', 'Orders can only be cancelled before the restaurant accepts them');
  end if;

  update orders set status = 'cancelled', updated_at = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('status', 'cancelled', 'by', 'customer'));

  return public.rpc_get_order_detail(p_order_id);
end; $$;

-- ── rpc_owner_update_order_status (v2: new transitions) ───────
create or replace function public.rpc_owner_update_order_status(
  p_order_id   uuid,
  p_new_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_rest_id    uuid := public.get_my_restaurant_id();
  v_order      record;
  v_new_status order_status;
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  begin
    v_new_status := p_new_status::order_status;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid status value: ' || p_new_status);
  end;

  select * into v_order
  from orders o
  where o.id = p_order_id and o.restaurant_id = v_rest_id;

  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  if not (
    -- legacy transitions kept for old app versions mid-rollout
    (v_order.status = 'pending'          and v_new_status in ('preparing', 'cancelled')) or
    (v_order.status = 'preparing'        and v_new_status = 'out_for_delivery') or
    (v_order.status = 'out_for_delivery' and v_new_status = 'delivered') or
    -- new lifecycle
    (v_order.status = 'preparing'        and v_new_status in ('ready_for_pickup', 'cancelled')) or
    (v_order.status = 'ready_for_pickup' and v_new_status = 'picked_up_by_customer'
       and v_order.order_type = 'pickup') or
    (v_order.status = 'ready_for_pickup' and v_new_status = 'cancelled')
  ) then
    return jsonb_build_object(
      'error', 'Invalid transition from ' || v_order.status::text || ' to ' || p_new_status
    );
  end if;

  update orders set
    status = v_new_status,
    delivered_at = case when v_new_status in ('delivered', 'picked_up_by_customer')
                        then now() else delivered_at end,
    updated_at = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('status', v_new_status));

  -- Customer always hears about it
  perform public.notify_order_event('status_change', p_order_id);

  -- Driver-facing events for delivery orders
  if v_order.order_type = 'delivery' then
    if v_new_status = 'ready_for_pickup' and v_order.driver_id is not null then
      perform public.notify_order_event('order_ready', p_order_id);
    elsif v_new_status = 'cancelled' then
      perform public.notify_order_event('order_cancelled_driver', p_order_id);
    end if;
  end if;

  return public.owner_order_json(p_order_id);
end; $$;

-- ── rpc_rate_order (v2: pickup orders can be rated too) ───────
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

  if v_order.status not in ('delivered', 'picked_up_by_customer') then
    return jsonb_build_object('error', 'You can only rate a completed order');
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

-- ── notify_owner_on_new_order → reuse shared helper ───────────
create or replace function public.notify_owner_on_new_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_order_event('new_order', new.id);
  return new;
end; $$;

-- ============================================================
-- Removal of restaurants.delivery_fee / min_order_amount
-- (dependent RPCs are recreated first, columns dropped last)
-- ============================================================

-- ── rpc_get_restaurants (v2: no fee/min-order in output) ──────
create or replace function public.rpc_get_restaurants(
  p_page          integer  default 1,
  p_page_size     integer  default 10,
  p_search        text     default null,
  p_category_id   uuid     default null,
  p_accepts_online boolean  default null,
  p_is_accepting  boolean  default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  select count(*) into v_total
  from restaurants r
  where r.is_active = true
    and (p_search is null or
         to_tsvector('simple', coalesce(r.name_ar,'') || ' ' || coalesce(r.name_en,''))
         @@ plainto_tsquery('simple', p_search))
    and (p_category_id is null or exists(
           select 1 from restaurant_categories rc
           where rc.restaurant_id = r.id and rc.category_id = p_category_id))
    and (p_accepts_online is null or r.accepts_online_orders = p_accepts_online)
    and (p_is_accepting  is null or r.is_accepting_orders   = p_is_accepting);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select
      r.id, r.name_ar, r.name_en, r.logo_url, r.cover_url,
      r.accepts_online_orders, r.is_accepting_orders,
      r.estimated_delivery_time,
      r.created_at,
      coalesce(round(
        (select avg(o.restaurant_rating) from orders o
         where o.restaurant_id = r.id and o.restaurant_rating is not null)::numeric, 1), 0
      ) as average_rating,
      (select count(*) from orders o
       where o.restaurant_id = r.id and o.restaurant_rating is not null) as ratings_count,
      coalesce(
        (select jsonb_agg(jsonb_build_object('id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en))
         from restaurant_categories rc join categories c on c.id = rc.category_id
         where rc.restaurant_id = r.id), '[]'::jsonb
      ) as categories
    from restaurants r
    where r.is_active = true
      and (p_search is null or
           to_tsvector('simple', coalesce(r.name_ar,'') || ' ' || coalesce(r.name_en,''))
           @@ plainto_tsquery('simple', p_search))
      and (p_category_id is null or exists(
             select 1 from restaurant_categories rc
             where rc.restaurant_id = r.id and rc.category_id = p_category_id))
      and (p_accepts_online is null or r.accepts_online_orders = p_accepts_online)
      and (p_is_accepting  is null or r.is_accepting_orders   = p_is_accepting)
    order by r.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object(
      'total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)
    )
  );
end; $$;

-- ── rpc_get_restaurant_detail (v2: no fee/min-order) ──────────
create or replace function public.rpc_get_restaurant_detail(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r jsonb;
begin
  select jsonb_build_object(
    'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
    'logo_url', r.logo_url, 'cover_url', r.cover_url,
    'description_ar', r.description_ar, 'description_en', r.description_en,
    'accepts_online_orders', r.accepts_online_orders,
    'is_accepting_orders', r.is_accepting_orders,
    'estimated_delivery_time', r.estimated_delivery_time,
    'created_at', r.created_at, 'updated_at', r.updated_at,
    'average_rating', coalesce(round(
      (select avg(o.restaurant_rating) from orders o
       where o.restaurant_id = r.id and o.restaurant_rating is not null)::numeric, 1), 0),
    'ratings_count', (select count(*) from orders o where o.restaurant_id = r.id and o.restaurant_rating is not null),
    'categories', coalesce(
      (select jsonb_agg(jsonb_build_object('id',c.id,'name_ar',c.name_ar,'name_en',c.name_en,'image_url',c.image_url))
       from restaurant_categories rc join categories c on c.id = rc.category_id
       where rc.restaurant_id = r.id), '[]'::jsonb),
    'branches', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id',b.id,'name_ar',b.name_ar,'name_en',b.name_en,
         'address_ar',b.address_ar,'address_en',b.address_en,'location_url',b.location_url,
         'phones', coalesce(
           (select jsonb_agg(bp.phone) from branch_phones bp where bp.branch_id = b.id), '[]'::jsonb)
       )) from branches b where b.restaurant_id = r.id), '[]'::jsonb),
    'gallery', coalesce(
      (select jsonb_agg(jsonb_build_object('id',g.id,'image_url',g.image_url,'description',g.description) order by g.sort_order)
       from restaurant_gallery g where g.restaurant_id = r.id), '[]'::jsonb),
    'menu', case when r.accepts_online_orders then coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id',mi.id,'name_ar',mi.name_ar,'name_en',mi.name_en,'price',mi.price,
         'description_ar',mi.description_ar,'description_en',mi.description_en,
         'image_url',mi.image_url,'is_available',mi.is_available,'sort_order',mi.sort_order,
         'category_id',mi.category_id,
         'category_name_ar',(select c.name_ar from categories c where c.id = mi.category_id),
         'category_name_en',(select c.name_en from categories c where c.id = mi.category_id)
       ) order by mi.sort_order, mi.created_at)
       from menu_items mi where mi.restaurant_id = r.id and mi.is_available = true),
      '[]'::jsonb) else '[]'::jsonb end,
    'reviews', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'rating',o.restaurant_rating,'review',o.restaurant_review,
         'created_at',o.rated_at,
         'user_name',(select p.full_name from profiles p where p.id = o.user_id)
       ) order by o.rated_at desc)
       from orders o where o.restaurant_id = r.id and o.restaurant_rating is not null),
      '[]'::jsonb)
  ) into v_r
  from restaurants r
  where r.id = p_restaurant_id and r.is_active = true;

  return coalesce(v_r, jsonb_build_object('error', 'Restaurant not found'));
end; $$;

-- ── rpc_owner_update_restaurant_settings (v2: no fee/min) ─────
drop function if exists public.rpc_owner_update_restaurant_settings(boolean, numeric, numeric, integer);

create function public.rpc_owner_update_restaurant_settings(
  p_is_accepting_orders     boolean default null,
  p_estimated_delivery_time integer default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  update restaurants set
    is_accepting_orders     = coalesce(p_is_accepting_orders,    is_accepting_orders),
    estimated_delivery_time = coalesce(p_estimated_delivery_time, estimated_delivery_time),
    updated_at              = now()
  where id = v_rest_id;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'restaurants', v_rest_id::text);

  return (
    select jsonb_build_object(
      'id',                     r.id,
      'name_ar',                r.name_ar,
      'name_en',                r.name_en,
      'logo_url',               r.logo_url,
      'cover_url',              r.cover_url,
      'is_accepting_orders',    r.is_accepting_orders,
      'accepts_online_orders',  r.accepts_online_orders,
      'estimated_delivery_time', r.estimated_delivery_time
    )
    from restaurants r where r.id = v_rest_id
  );
end; $$;

-- ── rpc_owner_update_restaurant (v2: no fee/min) ──────────────
drop function if exists public.rpc_owner_update_restaurant(
  text, text, text, text, text, text, numeric, numeric, integer, boolean, boolean);

create function public.rpc_owner_update_restaurant(
  p_name_ar               text    default null,
  p_name_en               text    default null,
  p_description_ar        text    default null,
  p_description_en        text    default null,
  p_logo_url              text    default null,
  p_cover_url             text    default null,
  p_estimated_delivery    integer default null,
  p_is_accepting_orders   boolean default null,
  p_accepts_online_orders boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  update restaurants set
    name_ar               = coalesce(p_name_ar,             name_ar),
    name_en               = coalesce(p_name_en,             name_en),
    description_ar        = coalesce(p_description_ar,      description_ar),
    description_en        = coalesce(p_description_en,      description_en),
    logo_url              = coalesce(p_logo_url,            logo_url),
    cover_url             = coalesce(p_cover_url,           cover_url),
    estimated_delivery_time = coalesce(p_estimated_delivery, estimated_delivery_time),
    is_accepting_orders   = coalesce(p_is_accepting_orders, is_accepting_orders),
    accepts_online_orders = coalesce(p_accepts_online_orders, accepts_online_orders),
    updated_at = now()
  where id = v_rest_id;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'restaurants', v_rest_id::text);

  return public.rpc_get_restaurant_detail(v_rest_id);
end; $$;

-- ── rpc_admin_create_restaurant (v2: commission, no fee/min) ──
drop function if exists public.rpc_admin_create_restaurant(
  text, text, text, text, text, text, numeric, numeric, boolean, uuid[]);

create function public.rpc_admin_create_restaurant(
  p_name_ar               text,
  p_name_en               text,
  p_description_ar        text    default null,
  p_description_en        text    default null,
  p_logo_url              text    default null,
  p_cover_url             text    default null,
  p_commission_percentage numeric default 0,
  p_accepts_online        boolean default false,
  p_category_ids          uuid[]  default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_rest_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  if p_commission_percentage < 0 or p_commission_percentage > 100 then
    return jsonb_build_object('error', 'Commission percentage must be between 0 and 100');
  end if;

  insert into restaurants (
    name_ar, name_en, description_ar, description_en,
    logo_url, cover_url, commission_percentage,
    accepts_online_orders, is_active
  ) values (
    p_name_ar, p_name_en, p_description_ar, p_description_en,
    p_logo_url, p_cover_url, p_commission_percentage,
    p_accepts_online, true
  ) returning id into v_rest_id;

  if p_category_ids is not null then
    insert into restaurant_categories (restaurant_id, category_id)
    select v_rest_id, unnest(p_category_ids)
    on conflict do nothing;
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'restaurants', v_rest_id::text,
    jsonb_build_object('name_ar', p_name_ar, 'name_en', p_name_en));

  return public.rpc_get_restaurant_detail(v_rest_id);
end; $$;

-- ── Finally: drop the obsolete restaurant columns ─────────────
alter table public.restaurants
  drop column if exists delivery_fee,
  drop column if exists min_order_amount;
