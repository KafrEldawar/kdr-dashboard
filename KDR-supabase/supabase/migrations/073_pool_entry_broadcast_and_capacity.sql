-- ============================================================
-- 073: The pool tells drivers when it changes, and offices can go to 100.
--
-- Three things, all from one testing session:
--
-- 1. A restaurant accepting an order pushed the notification but the
--    order did not appear in the driver's list until pull-to-refresh.
--    The client subscribes to postgres_changes on `orders`, but an order
--    that becomes claimable moves *into* the driver's RLS visibility —
--    and with the default replica identity there is no old row to
--    evaluate the policy against, so the event never reaches them. This
--    is the same limitation 040 already worked around with a broadcast
--    for claim/cancel; new pool entries were simply never covered.
--
--    Fixed with a trigger rather than another `realtime.send` inside
--    rpc_owner_update_order_status: an order can enter the pool from the
--    owner RPC, from a driver releasing it, or from an admin changing
--    the status in the dashboard. One trigger on the table catches all
--    three and every path added later.
--
-- 2. Releasing an order sent no push at all. It went back to the pool
--    silently, so a rider sitting in the app had no reason to look. The
--    broadcast covers whoever already has the screen open; the push is
--    what reaches the ones who don't.
--
-- 3. Office capacity was capped at 50. Raised to 100.
-- ============================================================

-- ── 1) Broadcast when an order enters the claimable pool ─────
create or replace function public.tg_orders_broadcast_pool_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_now boolean;
  v_was boolean;
begin
  -- Same predicate rpc_driver_get_available_orders selects on. If these
  -- two ever disagree, drivers get told about orders they cannot see.
  v_now := new.driver_id is null
       and new.order_type = 'delivery'
       and coalesce(new.delivery_by_owner, false) = false
       and new.status in ('preparing', 'ready_for_pickup');

  if not v_now then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_was := old.driver_id is null
         and old.order_type = 'delivery'
         and coalesce(old.delivery_by_owner, false) = false
         and old.status in ('preparing', 'ready_for_pickup');
    -- Already sitting in the pool: this update changed something else
    -- (a note, an address). Nothing new to announce.
    if v_was then
      return null;
    end if;
  end if;

  -- Fan-out must never be able to fail an order. A realtime hiccup
  -- costing a restaurant its order confirmation is a far worse outcome
  -- than a driver refreshing manually.
  begin
    perform realtime.send(
      jsonb_build_object('order_id', new.id),
      'order_available',
      'delivery_pool',
      true
    );
  exception when others then
    null;
  end;

  return null;
end; $$;

drop trigger if exists trg_orders_broadcast_pool_entry on public.orders;
create trigger trg_orders_broadcast_pool_entry
  after insert or update on public.orders
  for each row execute function public.tg_orders_broadcast_pool_entry();


-- ── 2) rpc_driver_release_order v2 — push, not just broadcast ─
-- Unchanged from 067 except for the notify_order_event call.
create or replace function public.rpc_driver_release_order(
  p_order_id uuid,
  p_reason   text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_order    record;
  v_released uuid;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select * into v_order from orders where id = p_order_id and driver_id = v_uid;
  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  if v_order.status not in ('preparing', 'ready_for_pickup') then
    return jsonb_build_object('error', 'too_late_to_release');
  end if;

  update orders set
    driver_id   = null,
    courier_id  = null,
    claimed_at  = null,
    assigned_at = null,
    updated_at  = now()
  where id = p_order_id
    and driver_id = v_uid
    and status in ('preparing', 'ready_for_pickup')
  returning id into v_released;

  if v_released is null then
    return jsonb_build_object('error', 'release_failed');
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('action', 'release', 'reason', p_reason));

  -- Kept for app versions already in the field, which only listen for
  -- 'order_released'. New builds also get 'order_available' from the
  -- trigger above; the client debounces the pair into one refresh.
  perform realtime.send(
    jsonb_build_object('order_id', p_order_id, 'released_by', v_uid),
    'order_released',
    'delivery_pool',
    true
  );

  -- The order is genuinely up for grabs again — treat it exactly like a
  -- new one. Without this it went back to the pool in silence and sat
  -- there until somebody happened to look.
  perform public.notify_order_event('order_available', p_order_id);

  return jsonb_build_object('released', true, 'order_id', p_order_id);
end; $$;

revoke execute on function public.rpc_driver_release_order(uuid, text) from anon, public;
grant  execute on function public.rpc_driver_release_order(uuid, text) to authenticated;


-- ── 3) Office capacity ceiling 50 -> 100 ─────────────────────
alter table public.delivery_providers
  drop constraint if exists delivery_providers_max_concurrent_orders_check;

alter table public.delivery_providers
  add constraint delivery_providers_max_concurrent_orders_check
  check (max_concurrent_orders >= 1 and max_concurrent_orders <= 100);
