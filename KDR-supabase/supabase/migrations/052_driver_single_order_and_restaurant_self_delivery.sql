-- ============================================================
-- 052: Single-order enforcement for drivers +
--      per-restaurant self-delivery permission
--
-- Two closely-related contract changes that need to land together
-- because the mobile client reads them off the same accept-order /
-- claim-order response cycle:
--
-- 1) Drivers may only carry ONE active order at a time. The claim
--    RPC now refuses when the driver has any order still in
--    ('preparing', 'ready_for_pickup', 'out_for_delivery'), and the
--    pool listing short-circuits to empty for those drivers so the
--    UI can't tempt them to try. Prevents the "driver juggling two
--    orders from opposite ends of town" mess we've been seeing.
--
-- 2) Restaurant self-delivery is now opt-in per restaurant via
--    `restaurants.self_delivery_enabled` (default false). The
--    accept-order RPC rejects `p_delivery_by_owner=true` when the
--    restaurant isn't allowed; the dashboard toggle drives who's
--    allowed. Mobile hides the "قبول وتوصيل بنفسي" button when the
--    flag is off, but the server is authoritative.
--
-- `rpc_owner_get_dashboard` already returns the whole restaurant row
-- via `to_jsonb(r)`, so the new column surfaces to mobile without
-- touching that RPC.
-- ============================================================

-- ── 1) Restaurant-level self-delivery permission ─────────────
alter table public.restaurants
  add column if not exists self_delivery_enabled boolean not null default false;

-- ── Index for the "does this driver have an active order?" check.
--    Partial index keeps it tiny — only rows in the active states matter.
create index if not exists idx_orders_driver_active
  on public.orders (driver_id)
  where status in ('preparing', 'ready_for_pickup', 'out_for_delivery');


-- ── 2) rpc_driver_claim_order v4 (single-order guard) ────────
-- Refuses the claim when the driver still has an order in progress.
-- The check runs before the atomic UPDATE so we never mutate on a
-- rejected claim. The active check is per-driver, not per-order, so
-- it also catches the "picked up but not yet delivered" state.
create or replace function public.rpc_driver_claim_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_active  int;
  v_claimed uuid;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select count(*) into v_active from orders
  where driver_id = v_uid
    and status in ('preparing', 'ready_for_pickup', 'out_for_delivery');
  if v_active > 0 then
    return jsonb_build_object('error', 'has_active_order');
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


-- ── 3) rpc_driver_get_available_orders v3 (empty when busy) ──
-- Drivers who already have an active order get an empty pool.
-- Meta carries `has_active_order` so the client can render the
-- "finish your current order first" banner without a second RPC.
create or replace function public.rpc_driver_get_available_orders(
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid    := auth.uid();
  v_offset     integer := (p_page - 1) * p_page_size;
  v_total      integer;
  v_data       jsonb;
  v_has_active boolean;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select exists(
    select 1 from orders
    where driver_id = v_uid
      and status in ('preparing', 'ready_for_pickup', 'out_for_delivery')
  ) into v_has_active;

  if v_has_active then
    return jsonb_build_object(
      'data', '[]'::jsonb,
      'meta', jsonb_build_object(
        'total', 0, 'page', p_page,
        'page_size', p_page_size, 'total_pages', 0,
        'has_active_order', true
      )
    );
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

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object(
      'total', v_total, 'page', p_page,
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size),
      'has_active_order', false
    )
  );
end; $$;


-- ── 4) rpc_owner_accept_order v3 (restaurant self-delivery gate)
-- The accept path now looks up `restaurants.self_delivery_enabled`
-- before honoring `p_delivery_by_owner=true`. Older app builds that
-- don't send the flag stay on the default-false code path and are
-- unaffected. The signature stays the same so the grant below is
-- a no-op for existing clients.
drop function if exists public.rpc_owner_accept_order(uuid, integer, boolean);
create or replace function public.rpc_owner_accept_order(
  p_order_id          uuid,
  p_prep_minutes      integer,
  p_delivery_by_owner boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid                uuid := auth.uid();
  v_rest_id            uuid := public.get_my_restaurant_id();
  v_order              record;
  v_self_deliv_allowed boolean;
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

  if p_delivery_by_owner then
    if v_order.order_type <> 'delivery' then
      return jsonb_build_object(
        'error', 'Self-delivery can only be enabled on delivery orders'
      );
    end if;
    select self_delivery_enabled into v_self_deliv_allowed
    from restaurants where id = v_rest_id;
    if not coalesce(v_self_deliv_allowed, false) then
      return jsonb_build_object(
        'error', 'self_delivery_disabled'
      );
    end if;
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
