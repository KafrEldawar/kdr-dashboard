-- ============================================================
-- 026: Delivery driver RPCs
-- ============================================================

-- ── driver order json helper (shared response shape) ──────────
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

-- ── rpc_driver_get_available_orders ───────────────────────────
-- Unclaimed delivery orders any driver can pick up.
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

-- ── rpc_driver_claim_order ────────────────────────────────────
-- First driver wins: one atomic UPDATE guarded by driver_id IS NULL.
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

-- ── rpc_driver_get_active_orders ──────────────────────────────
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

-- ── rpc_driver_get_order_detail ───────────────────────────────
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

-- ── rpc_driver_update_order_status ────────────────────────────
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

-- ── rpc_driver_get_stats ──────────────────────────────────────
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
