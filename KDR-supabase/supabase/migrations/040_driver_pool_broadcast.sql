-- ============================================================
-- 040: Driver pool realtime broadcast
-- ============================================================
-- Why this exists:
--   The standard postgres_changes subscription on `orders` is gated by
--   the RLS policy `orders: driver reads pool and own`. The instant
--   driver A claims a row, the row's NEW state has driver_id = A — so
--   it leaves the SELECT visibility of every OTHER driver, and Supabase
--   Realtime drops the UPDATE event for them. Result: the claimed card
--   stays stuck on the losing drivers' screens until they pull-to-
--   refresh.
--
--   Same shape on cancellation while the order is still in the pool
--   (status moves to 'cancelled', no longer matches RLS).
--
--   Fix: a side-channel broadcast on the 'delivery_pool' topic. Every
--   driver client subscribes; whenever the pool composition changes
--   (claim / pool-cancel) we fan out a tiny payload so every listening
--   driver refreshes their list immediately.

-- RLS on realtime.messages so only authenticated drivers can listen.
drop policy if exists "drivers listen on delivery_pool" on realtime.messages;
create policy "drivers listen on delivery_pool"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'delivery_pool'
    and public.is_driver()
  );

-- ── rpc_driver_claim_order (v2: broadcasts on claim) ──────────
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

  -- Tell every listening driver the pool changed. postgres_changes can't
  -- reach the losing drivers here (the row leaves their RLS visibility),
  -- so this broadcast is the only fan-out they ever see for this event.
  perform realtime.send(
    jsonb_build_object('order_id', p_order_id, 'claimed_by', v_uid),
    'order_claimed',
    'delivery_pool',
    true
  );

  return public.driver_order_json(p_order_id);
end; $$;

-- ── rpc_owner_update_order_status (v3: broadcasts pool-cancel) ─
-- Same body as the live function with a single addition: when the
-- restaurant cancels a delivery order that's still unclaimed, fan out
-- a 'pool_cancelled' broadcast so foreground drivers drop the card
-- instantly (FCM stays as the slow path for backgrounded apps).
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

  v_has_driver := v_order.driver_id is not null;
  v_is_delivery := v_order.order_type = 'delivery';

  if v_new_status = 'cancelled' and v_is_delivery and v_has_driver then
    return jsonb_build_object(
      'error', 'لا يمكن إلغاء الطلب بعد قبول الكابتن — تواصل مع الدعم'
    );
  end if;

  if not (
    (v_order.status = 'pending'          and v_new_status in ('preparing', 'cancelled')) or
    (v_order.status = 'preparing'        and v_new_status in ('ready_for_pickup', 'cancelled')) or
    (v_order.status = 'ready_for_pickup' and v_new_status = 'picked_up_by_customer'
       and v_order.order_type = 'pickup') or
    (v_order.status = 'ready_for_pickup' and v_new_status = 'cancelled'
       and (not v_is_delivery or not v_has_driver))
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

  if v_is_delivery then
    if v_new_status = 'ready_for_pickup' and v_has_driver then
      perform public.notify_order_event('order_ready', p_order_id);
    elsif v_new_status = 'cancelled' then
      perform public.notify_order_event('order_cancelled_driver', p_order_id);
      -- Pool-only cancellation needs a broadcast: losing drivers can't see
      -- the UPDATE (RLS strips the row once status leaves the pool set).
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
