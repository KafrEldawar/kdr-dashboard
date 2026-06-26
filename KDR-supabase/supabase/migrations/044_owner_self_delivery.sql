-- ============================================================
-- 044: Owner self-delivery
--
-- Lets a restaurant owner take delivery into their own hands when
-- they accept an order. The accept-order RPC now takes an opt-in
-- `delivery_by_owner` flag — when true, the order:
--   • skips the driver pool entirely (no order_available push, no
--     visibility in rpc_driver_get_available_orders, no claim path)
--   • advances on a 3-stage owner-driven flow:
--       preparing → out_for_delivery → delivered
--     (ready_for_pickup is the driver-handoff step and is not used)
--
-- Driver-facing pool queries are tightened to exclude self-delivery
-- so the flag is enforced by the data layer, not just the UI.
--
-- Owner dashboard gains four new stats so the owner can see what
-- their self-deliveries earned them in delivery fees (today + total).
-- The full delivery_fee is theirs — no commission applies to delivery,
-- only to the food subtotal (per the existing commission model from
-- migration 024).
-- ============================================================

alter table public.orders
  add column if not exists delivery_by_owner boolean not null default false;

-- Helps the dashboard stats query and the driver-pool exclusion stay
-- cheap when the orders table grows.
create index if not exists idx_orders_self_delivery
  on public.orders (restaurant_id, delivery_by_owner)
  where delivery_by_owner = true;


-- ── rpc_owner_accept_order (v2: optional self-delivery) ───────
-- Adds p_delivery_by_owner, defaulted to false so older app builds
-- keep working. When true, the order is marked as owner-delivered
-- (no driver_available push fires).
drop function if exists public.rpc_owner_accept_order(uuid, integer);
create or replace function public.rpc_owner_accept_order(
  p_order_id          uuid,
  p_prep_minutes      integer,
  p_delivery_by_owner boolean default false
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

  if p_delivery_by_owner and v_order.order_type <> 'delivery' then
    return jsonb_build_object(
      'error', 'Self-delivery can only be enabled on delivery orders'
    );
  end if;

  update orders set
    status                        = 'preparing',
    accepted_at                   = now(),
    estimated_preparation_minutes = p_prep_minutes,
    delivery_by_owner             = p_delivery_by_owner,
    updated_at                    = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object(
      'status',            'preparing',
      'prep_minutes',      p_prep_minutes,
      'delivery_by_owner', p_delivery_by_owner
    ));

  perform public.notify_order_event('status_change', p_order_id);
  -- Skip the driver ping when the restaurant takes delivery itself.
  if v_order.order_type = 'delivery' and not p_delivery_by_owner then
    perform public.notify_order_event('order_available', p_order_id);
  end if;

  return public.owner_order_json(p_order_id);
end; $$;

grant execute on function public.rpc_owner_accept_order(uuid, integer, boolean)
  to authenticated;


-- ── rpc_owner_update_order_status (v4: self-delivery transitions)
-- Adds two transitions that are allowed only when delivery_by_owner
-- is true:
--   preparing        → out_for_delivery   (owner heads out)
--   out_for_delivery → delivered          (owner hands off)
-- Cancellation is allowed at preparing (no driver to coordinate
-- with) but not after out_for_delivery — same spirit as the driver
-- path: once the food is on the road we don't refund-cancel.
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
  v_has_driver boolean;
  v_is_delivery boolean;
  v_self_deliv boolean;
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

  v_has_driver  := v_order.driver_id is not null;
  v_is_delivery := v_order.order_type = 'delivery';
  v_self_deliv  := v_order.delivery_by_owner;

  if v_new_status = 'cancelled' and v_is_delivery and v_has_driver then
    return jsonb_build_object(
      'error', 'لا يمكن إلغاء الطلب بعد قبول الكابتن — تواصل مع الدعم'
    );
  end if;

  if not (
    -- Pool path
    (v_order.status = 'pending'          and v_new_status in ('preparing', 'cancelled')) or
    (v_order.status = 'preparing'        and v_new_status in ('ready_for_pickup', 'cancelled')) or
    (v_order.status = 'ready_for_pickup' and v_new_status = 'picked_up_by_customer'
       and v_order.order_type = 'pickup') or
    (v_order.status = 'ready_for_pickup' and v_new_status = 'cancelled'
       and (not v_is_delivery or not v_has_driver)) or
    -- Self-delivery path (owner-only, no driver hand-off)
    (v_order.status = 'preparing'        and v_new_status = 'out_for_delivery'
       and v_self_deliv) or
    (v_order.status = 'out_for_delivery' and v_new_status = 'delivered'
       and v_self_deliv)
  ) then
    return jsonb_build_object(
      'error', 'Invalid transition from ' || v_order.status::text || ' to ' || p_new_status
    );
  end if;

  update orders set
    status       = v_new_status,
    picked_up_at = case when v_new_status = 'out_for_delivery' and v_self_deliv
                        then now() else picked_up_at end,
    delivered_at = case when v_new_status in ('delivered', 'picked_up_by_customer')
                        then now() else delivered_at end,
    updated_at   = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('status', v_new_status));

  perform public.notify_order_event('status_change', p_order_id);

  if v_is_delivery and not v_self_deliv then
    if v_new_status = 'ready_for_pickup' and v_has_driver then
      perform public.notify_order_event('order_ready', p_order_id);
    elsif v_new_status = 'cancelled' then
      perform public.notify_order_event('order_cancelled_driver', p_order_id);
      if not v_has_driver then
        perform realtime.send(
          jsonb_build_object('order_id', p_order_id, 'reason', 'cancelled'),
          'pool_cancelled',
          'delivery_pool',
          true
        );
      end if;
    end if;
  end if;

  return public.owner_order_json(p_order_id);
end; $$;


-- ── rpc_driver_get_available_orders (v2: exclude self-delivery) ─
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
    and delivery_by_owner = false
    and status in ('preparing', 'ready_for_pickup');

  select coalesce(jsonb_agg(public.driver_order_json(o.id) order by o.created_at desc), '[]'::jsonb)
  into v_data
  from (
    select id, created_at from orders
    where driver_id is null
      and order_type = 'delivery'
      and delivery_by_owner = false
      and status in ('preparing', 'ready_for_pickup')
    order by created_at desc
    limit p_page_size offset v_offset
  ) o;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page,
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;


-- ── rpc_driver_claim_order (v3: exclude self-delivery; keeps broadcast)
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
    and delivery_by_owner = false
    and status in ('preparing', 'ready_for_pickup')
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('error', 'already_claimed');
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('driver_id', v_uid, 'action', 'claim'));

  perform realtime.send(
    jsonb_build_object('order_id', p_order_id, 'claimed_by', v_uid),
    'order_claimed',
    'delivery_pool',
    true
  );

  return public.driver_order_json(p_order_id);
end; $$;


-- ── owner_order_json (surface delivery_by_owner) ──────────────
create or replace function public.owner_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                o.id,
    'status',            o.status,
    'order_type',        o.order_type,
    'delivery_by_owner', o.delivery_by_owner,
    'total_amount',      o.total_amount,
    'subtotal',          o.subtotal,
    'delivery_fee',      o.delivery_fee,
    'discount',          o.discount,
    'delivery_address',  o.delivery_address,
    'contact_phone',     o.contact_phone,
    'alternate_phone',   o.alternate_phone,
    'notes',             o.notes,
    'accepted_at',       o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'rejection_reason',  o.rejection_reason,
    'picked_up_at',      o.picked_up_at,
    'delivered_at',      o.delivered_at,
    'created_at',        o.created_at,
    'updated_at',        o.updated_at,
    'items_count',       (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',          jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
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
  from orders o left join profiles p on p.id = o.user_id
  where o.id = p_order_id;
$$;

revoke execute on function public.owner_order_json(uuid) from anon, public;


-- ── driver_order_json (surface delivery_by_owner) ─────────────
create or replace function public.driver_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                o.id,
    'status',            o.status,
    'order_type',        o.order_type,
    'delivery_by_owner', o.delivery_by_owner,
    'total_amount',      o.total_amount,
    'subtotal',          o.subtotal,
    'delivery_fee',      o.delivery_fee,
    'discount',          o.discount,
    'delivery_address',  o.delivery_address,
    'contact_phone',     o.contact_phone,
    'alternate_phone',   o.alternate_phone,
    'notes',             o.notes,
    'accepted_at',       o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'claimed_at',        o.claimed_at,
    'picked_up_at',      o.picked_up_at,
    'delivered_at',      o.delivered_at,
    'created_at',        o.created_at,
    'updated_at',        o.updated_at,
    'driver_id',         o.driver_id,
    'items_count',       (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',          jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
    'restaurant',        jsonb_build_object(
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
  left join profiles p on p.id = o.user_id
  join restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id;
$$;

revoke execute on function public.driver_order_json(uuid) from anon, public;


-- ── rpc_get_order_detail (surface delivery_by_owner) ──────────
create or replace function public.rpc_get_order_detail(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_o   jsonb;
begin
  select jsonb_build_object(
    'id', o.id, 'status', o.status,
    'order_type', o.order_type,
    'delivery_by_owner', o.delivery_by_owner,
    'delivery_address', o.delivery_address,
    'contact_phone', o.contact_phone,
    'alternate_phone', o.alternate_phone,
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


-- ── rpc_admin_get_financial_report (segment self-delivery) ────
-- Adds `self_delivery_orders_count` and `self_delivery_earnings`
-- (sum of delivery_fee on completed self-delivery orders) to the
-- totals, periods, and per-restaurant breakdown so admins can see
-- in-house delivery activity separately from platform-driver work.
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
    'restaurant_revenue', coalesce(sum(restaurant_revenue), 0),
    'self_delivery_orders_count',
      count(*) filter (where delivery_by_owner),
    'self_delivery_earnings',
      coalesce(sum(delivery_fee) filter (where delivery_by_owner), 0)
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
      coalesce(sum(restaurant_revenue), 0)  as restaurant_revenue,
      count(*) filter (where delivery_by_owner)
        as self_delivery_orders_count,
      coalesce(sum(delivery_fee) filter (where delivery_by_owner), 0)
        as self_delivery_earnings
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
      coalesce(sum(o.restaurant_revenue), 0) as restaurant_revenue,
      count(o.id) filter (where o.delivery_by_owner)
        as self_delivery_orders_count,
      coalesce(sum(o.delivery_fee) filter (where o.delivery_by_owner), 0)
        as self_delivery_earnings
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

-- ── rpc_admin_get_unclaimed_orders (skip self-delivery) ───────
-- Self-delivery orders never enter the driver pool, so alerting on
-- them as "unclaimed" would be a false positive. Filter them out.
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
       and o.delivery_by_owner = false
       and o.driver_id is null
       and o.status in ('preparing', 'ready_for_pickup')
       and o.accepted_at is not null
       and o.accepted_at + make_interval(mins => coalesce(o.estimated_preparation_minutes, 0)) < now()),
    '[]'::jsonb
  );
end; $$;


-- ── rpc_owner_get_dashboard (add self-delivery stats) ─────────
-- Adds four counters under the existing `stats` object:
--   self_delivery_today          — count of orders accepted with the
--                                  self-delivery flag today
--   self_delivery_total          — lifetime count of self-delivery orders
--   self_delivery_earnings_today — sum of delivery_fee for self-delivery
--                                  orders delivered today
--   self_delivery_earnings_total — lifetime sum of delivery_fee for
--                                  delivered self-delivery orders
create or replace function public.rpc_owner_get_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  return jsonb_build_object(
    'restaurant', (select to_jsonb(r) from restaurants r where r.id = v_rest_id),
    'stats', jsonb_build_object(
      'orders_total',    (select count(*) from orders where restaurant_id = v_rest_id),
      'orders_today',    (select count(*) from orders where restaurant_id = v_rest_id and created_at::date = current_date),
      'orders_pending',  (select count(*) from orders where restaurant_id = v_rest_id and status = 'pending'),
      'revenue_today',   (select coalesce(sum(total_amount), 0) from orders
                          where restaurant_id = v_rest_id and created_at::date = current_date and status <> 'cancelled'),
      'average_rating',  (select coalesce(round(avg(restaurant_rating)::numeric, 1), 0)
                          from orders where restaurant_id = v_rest_id and restaurant_rating is not null),
      'ratings_count',   (select count(*) from orders where restaurant_id = v_rest_id and restaurant_rating is not null),
      'menu_items',      (select count(*) from menu_items where restaurant_id = v_rest_id and is_available = true),

      'self_delivery_today',
        (select count(*) from orders
          where restaurant_id = v_rest_id
            and delivery_by_owner = true
            and accepted_at::date = current_date),
      'self_delivery_total',
        (select count(*) from orders
          where restaurant_id = v_rest_id
            and delivery_by_owner = true),
      'self_delivery_earnings_today',
        (select coalesce(sum(delivery_fee), 0) from orders
          where restaurant_id = v_rest_id
            and delivery_by_owner = true
            and status = 'delivered'
            and delivered_at::date = current_date),
      'self_delivery_earnings_total',
        (select coalesce(sum(delivery_fee), 0) from orders
          where restaurant_id = v_rest_id
            and delivery_by_owner = true
            and status = 'delivered')
    ),
    'recent_orders', coalesce(
      -- jsonb_agg(...) order by needs its source set to already be the
      -- top-10. Applying ORDER BY + LIMIT outside the aggregate is illegal
      -- (the column isn't grouped/aggregated) and broke the whole RPC.
      (select jsonb_agg(jsonb_build_object(
         'id', sub.id, 'status', sub.status, 'total_amount', sub.total_amount,
         'created_at', sub.created_at,
         'customer_name', (select p.full_name from profiles p where p.id = sub.user_id)
       ) order by sub.created_at desc)
       from (
         select id, status, total_amount, created_at, user_id
         from orders
         where restaurant_id = v_rest_id
         order by created_at desc
         limit 10
       ) sub),
      '[]'::jsonb
    )
  );
end; $$;
