-- ============================================================
-- Hotfix Step 2: Migrations 024 → 027
-- Run AFTER hotfix_step1_enums.sql is committed.
-- ============================================================

-- ============================================================
-- 024: Orders schema — order types, prep time, driver, commission
-- ============================================================

alter table public.orders
  add column if not exists order_type                    public.order_type not null default 'delivery',
  add column if not exists accepted_at                   timestamptz,
  add column if not exists estimated_preparation_minutes integer,
  add column if not exists rejection_reason              text,
  add column if not exists driver_id                     uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_at                    timestamptz,
  add column if not exists picked_up_at                  timestamptz,
  add column if not exists delivered_at                  timestamptz,
  add column if not exists commission_percentage         numeric(5,2)  not null default 0,
  add column if not exists commission_amount             numeric(10,2) not null default 0,
  add column if not exists restaurant_revenue            numeric(10,2) not null default 0;

alter table public.orders alter column delivery_address drop not null;

alter table public.restaurants
  add column if not exists commission_percentage numeric(5,2) not null default 0
  check (commission_percentage >= 0 and commission_percentage <= 100);

create index if not exists idx_orders_driver on public.orders(driver_id);

create index if not exists idx_orders_claimable
  on public.orders(created_at)
  where driver_id is null and order_type = 'delivery';

create or replace function public.is_driver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt()->>'user_role', '') = 'driver',
    exists(select 1 from public.profiles where id = auth.uid() and role = 'driver')
  );
$$;

revoke execute on function public.is_driver() from anon, public;

-- notify_order_event: shared helper (::text bug fixed)
create or replace function public.notify_order_event(p_event text, p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_supa_url text;
  v_supa_key text;
begin
  select value into v_supa_url from app_config where key = 'supabase_url';
  select value into v_supa_key from app_config where key = 'supabase_service_key';

  if v_supa_url is null or v_supa_key is null then
    return;
  end if;

  begin
    perform net.http_post(
      url     := v_supa_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_supa_key
      ),
      body    := jsonb_build_object('event', p_event, 'order_id', p_order_id)
    );
  exception when others then null;
  end;
end; $$;

revoke execute on function public.notify_order_event(text, uuid) from anon, public;

drop policy if exists "orders: driver reads pool and own" on public.orders;
create policy "orders: driver reads pool and own"
  on public.orders for select
  using (
    public.is_driver()
    and (
      driver_id = auth.uid()
      or (driver_id is null
          and order_type = 'delivery'
          and status in ('preparing', 'ready_for_pickup'))
    )
  );

drop policy if exists "order_items: driver reads claimed" on public.order_items;
create policy "order_items: driver reads claimed"
  on public.order_items for select
  using (
    public.is_driver()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.driver_id = auth.uid()
    )
  );


-- ============================================================
-- 025: Order lifecycle RPCs
-- ============================================================

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

drop function if exists public.rpc_checkout(text, text, text, text);
drop function if exists public.rpc_checkout(text, text, text, text, text);

create or replace function public.rpc_checkout(
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

  select mi.restaurant_id, sum(ci.quantity * mi.price)
  into v_rest_id, v_subtotal
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id
  group by mi.restaurant_id;

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

  v_total := greatest(v_subtotal - v_discount, 0);

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

  insert into order_items (order_id, menu_item_id, item_name_en, item_name_ar, price, quantity, special_instructions)
  select v_order_id, ci.menu_item_id, mi.name_en, mi.name_ar, mi.price, ci.quantity, ci.special_instructions
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id;

  delete from cart_items where cart_id = v_cart_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'orders', v_order_id::text,
    jsonb_build_object('total', v_total, 'restaurant_id', v_rest_id, 'order_type', v_order_type));

  return public.rpc_get_order_detail(v_order_id);
end; $$;

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
    (v_order.status = 'pending'          and v_new_status in ('preparing', 'cancelled')) or
    (v_order.status = 'preparing'        and v_new_status = 'out_for_delivery') or
    (v_order.status = 'out_for_delivery' and v_new_status = 'delivered') or
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

  perform public.notify_order_event('status_change', p_order_id);

  if v_order.order_type = 'delivery' then
    if v_new_status = 'ready_for_pickup' and v_order.driver_id is not null then
      perform public.notify_order_event('order_ready', p_order_id);
    elsif v_new_status = 'cancelled' then
      perform public.notify_order_event('order_cancelled_driver', p_order_id);
    end if;
  end if;

  return public.owner_order_json(p_order_id);
end; $$;

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

-- Replace the 020 trigger with the clean version using notify_order_event
create or replace function public.notify_owner_on_new_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_order_event('new_order', new.id);
  return new;
end; $$;

drop function if exists public.rpc_owner_update_restaurant_settings(boolean, numeric, numeric, integer);
drop function if exists public.rpc_owner_update_restaurant_settings(boolean, integer);

create or replace function public.rpc_owner_update_restaurant_settings(
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

drop function if exists public.rpc_owner_update_restaurant(
  text, text, text, text, text, text, numeric, numeric, integer, boolean, boolean);
drop function if exists public.rpc_owner_update_restaurant(
  text, text, text, text, text, text, integer, boolean, boolean);

create or replace function public.rpc_owner_update_restaurant(
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

drop function if exists public.rpc_admin_create_restaurant(
  text, text, text, text, text, text, numeric, numeric, boolean, uuid[]);
drop function if exists public.rpc_admin_create_restaurant(
  text, text, text, text, text, text, numeric, boolean, uuid[]);

create or replace function public.rpc_admin_create_restaurant(
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

alter table public.restaurants
  drop column if exists delivery_fee,
  drop column if exists min_order_amount;


-- ============================================================
-- 026: Delivery driver RPCs
-- ============================================================

create or replace function public.driver_order_json(p_order_id uuid)
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
    'claimed_at',       o.claimed_at,
    'picked_up_at',     o.picked_up_at,
    'delivered_at',     o.delivered_at,
    'created_at',       o.created_at,
    'updated_at',       o.updated_at,
    'driver_id',        o.driver_id,
    'items_count',      (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',         jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
    'restaurant',       jsonb_build_object(
                          'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
                          'logo_url', r.logo_url),
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
  from orders o
  join profiles p on p.id = o.user_id
  join restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id;
$$;

revoke execute on function public.driver_order_json(uuid) from anon, public;

create or replace function public.rpc_driver_get_available_orders(
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid    := auth.uid();
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select count(*) into v_total from orders
  where driver_id is null
    and order_type = 'delivery'
    and status in ('preparing', 'ready_for_pickup');

  select coalesce(jsonb_agg(public.driver_order_json(o.id) order by o.created_at desc), '[]'::jsonb)
  into v_data
  from (
    select id, created_at from orders
    where driver_id is null
      and order_type = 'delivery'
      and status in ('preparing', 'ready_for_pickup')
    order by created_at desc
    limit p_page_size offset v_offset
  ) o;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page,
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

create or replace function public.rpc_driver_claim_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_claimed uuid;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  update orders set
    driver_id  = v_uid,
    claimed_at = now(),
    updated_at = now()
  where id = p_order_id
    and driver_id is null
    and order_type = 'delivery'
    and status in ('preparing', 'ready_for_pickup')
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('error', 'already_claimed');
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('driver_id', v_uid, 'action', 'claim'));

  return public.driver_order_json(p_order_id);
end; $$;

create or replace function public.rpc_driver_get_active_orders()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  return coalesce(
    (select jsonb_agg(public.driver_order_json(o.id) order by o.claimed_at desc)
     from orders o
     where o.driver_id = v_uid
       and o.status in ('preparing', 'ready_for_pickup', 'out_for_delivery')),
    '[]'::jsonb
  );
end; $$;

create or replace function public.rpc_driver_get_order_detail(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_o   jsonb;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select public.driver_order_json(o.id) into v_o
  from orders o
  where o.id = p_order_id
    and (o.driver_id = v_uid
         or (o.driver_id is null
             and o.order_type = 'delivery'
             and o.status in ('preparing', 'ready_for_pickup')));

  return coalesce(v_o, jsonb_build_object('error', 'Order not found or access denied'));
end; $$;

create or replace function public.rpc_driver_update_order_status(
  p_order_id   uuid,
  p_new_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_order      record;
  v_new_status order_status;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  begin
    v_new_status := p_new_status::order_status;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid status value: ' || p_new_status);
  end;

  select * into v_order from orders
  where id = p_order_id and driver_id = v_uid;

  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  if not (
    (v_order.status = 'ready_for_pickup' and v_new_status = 'out_for_delivery') or
    (v_order.status = 'out_for_delivery' and v_new_status = 'delivered')
  ) then
    return jsonb_build_object(
      'error', 'Invalid transition from ' || v_order.status::text || ' to ' || p_new_status
    );
  end if;

  update orders set
    status       = v_new_status,
    picked_up_at = case when v_new_status = 'out_for_delivery' then now() else picked_up_at end,
    delivered_at = case when v_new_status = 'delivered'        then now() else delivered_at end,
    updated_at   = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('status', v_new_status, 'by', 'driver'));

  perform public.notify_order_event('status_change', p_order_id);

  return public.driver_order_json(p_order_id);
end; $$;

create or replace function public.rpc_driver_get_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  return jsonb_build_object(
    'total_deliveries',     (select count(*) from orders where driver_id = v_uid),
    'active_deliveries',    (select count(*) from orders where driver_id = v_uid
                             and status in ('preparing', 'ready_for_pickup', 'out_for_delivery')),
    'completed_deliveries', (select count(*) from orders where driver_id = v_uid and status = 'delivered'),
    'cancelled_deliveries', (select count(*) from orders where driver_id = v_uid and status = 'cancelled'),
    'today_deliveries',     (select count(*) from orders where driver_id = v_uid
                             and status = 'delivered' and delivered_at::date = current_date),
    'week_deliveries',      (select count(*) from orders where driver_id = v_uid
                             and status = 'delivered' and delivered_at >= date_trunc('week', now())),
    'month_deliveries',     (select count(*) from orders where driver_id = v_uid
                             and status = 'delivered' and delivered_at >= date_trunc('month', now()))
  );
end; $$;


-- ============================================================
-- 027: Admin finance & monitoring RPCs
-- ============================================================

create or replace function public.rpc_admin_get_financial_report(
  p_from          date default (current_date - interval '30 days')::date,
  p_to            date default current_date,
  p_restaurant_id uuid default null,
  p_group_by      text default 'day'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_totals     jsonb;
  v_periods    jsonb;
  v_by_rest    jsonb;
  v_trunc      text;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  if p_group_by not in ('day', 'month') then
    return jsonb_build_object('error', 'group_by must be day or month');
  end if;
  v_trunc := p_group_by;

  select jsonb_build_object(
    'orders_count',       count(*),
    'gross_sales',        coalesce(sum(total_amount), 0),
    'platform_revenue',   coalesce(sum(commission_amount), 0),
    'restaurant_revenue', coalesce(sum(restaurant_revenue), 0)
  ) into v_totals
  from orders
  where status in ('delivered', 'picked_up_by_customer')
    and created_at::date between p_from and p_to
    and (p_restaurant_id is null or restaurant_id = p_restaurant_id);

  select coalesce(jsonb_agg(t order by t.period), '[]'::jsonb) into v_periods
  from (
    select
      date_trunc(v_trunc, created_at)::date as period,
      count(*)                              as orders_count,
      coalesce(sum(total_amount), 0)        as gross_sales,
      coalesce(sum(commission_amount), 0)   as platform_revenue,
      coalesce(sum(restaurant_revenue), 0)  as restaurant_revenue
    from orders
    where status in ('delivered', 'picked_up_by_customer')
      and created_at::date between p_from and p_to
      and (p_restaurant_id is null or restaurant_id = p_restaurant_id)
    group by 1
  ) t;

  select coalesce(jsonb_agg(t order by t.platform_revenue desc), '[]'::jsonb) into v_by_rest
  from (
    select
      r.id                                  as restaurant_id,
      r.name_ar, r.name_en,
      r.commission_percentage               as current_commission_percentage,
      count(o.id)                           as orders_count,
      coalesce(sum(o.total_amount), 0)      as gross_sales,
      coalesce(sum(o.commission_amount), 0) as platform_revenue,
      coalesce(sum(o.restaurant_revenue), 0) as restaurant_revenue
    from restaurants r
    join orders o on o.restaurant_id = r.id
      and o.status in ('delivered', 'picked_up_by_customer')
      and o.created_at::date between p_from and p_to
    where (p_restaurant_id is null or r.id = p_restaurant_id)
    group by r.id, r.name_ar, r.name_en, r.commission_percentage
  ) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'group_by', p_group_by,
    'totals', v_totals,
    'periods', v_periods,
    'restaurants', v_by_rest
  );
end; $$;

create or replace function public.rpc_admin_get_unclaimed_orders()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  return coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id', o.id,
       'status', o.status,
       'total_amount', o.total_amount,
       'delivery_address', o.delivery_address,
       'accepted_at', o.accepted_at,
       'estimated_preparation_minutes', o.estimated_preparation_minutes,
       'overdue_minutes', floor(extract(epoch from (
          now() - (o.accepted_at + make_interval(mins => o.estimated_preparation_minutes))
        )) / 60),
       'restaurant', jsonb_build_object('id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en),
       'customer_name', (select p.full_name from profiles p where p.id = o.user_id)
     ) order by o.accepted_at)
     from orders o join restaurants r on r.id = o.restaurant_id
     where o.order_type = 'delivery'
       and o.driver_id is null
       and o.status in ('preparing', 'ready_for_pickup')
       and o.accepted_at is not null
       and o.accepted_at + make_interval(mins => coalesce(o.estimated_preparation_minutes, 0)) < now()),
    '[]'::jsonb
  );
end; $$;
