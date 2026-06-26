-- ============================================================
-- 045: Backfill phone_verified_at for legacy profiles + add
--     earnings aggregates to the driver stats RPC.
--
-- Two unrelated-but-tiny changes batched into one migration.
--
-- 1. profiles.phone_verified_at landed in migration 033. Any
--    profile that already had `phone` at that point (or that was
--    later updated via the old code paths that didn't touch the
--    column) is "verified by virtue of being signed in" but the
--    timestamp is null, which made checkout's gate falsely route
--    the user back through OTP. Backfill the timestamp to the
--    profile's created_at so the gate trusts it going forward.
--
-- 2. rpc_driver_get_stats only returned counts. Drivers asked to
--    see what they earned (today / this week / this month / total)
--    so they can track income. Compensation model: driver keeps
--    the full `delivery_fee` on every delivered order (mirrors the
--    self-delivery model for owners — no commission on delivery,
--    only on food).
-- ============================================================

-- 1. Backfill ----------------------------------------------------
update public.profiles
set phone_verified_at = coalesce(phone_verified_at, created_at, now())
where phone is not null
  and length(trim(phone)) > 0
  and phone_verified_at is null;

-- 2. Driver stats: counts + earnings -----------------------------
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
                             and status = 'delivered' and delivered_at >= date_trunc('month', now())),

    -- Earnings = sum(delivery_fee) on delivered orders for this driver.
    'earnings_today', (select coalesce(sum(delivery_fee), 0) from orders
                       where driver_id = v_uid and status = 'delivered'
                         and delivered_at::date = current_date),
    'earnings_week',  (select coalesce(sum(delivery_fee), 0) from orders
                       where driver_id = v_uid and status = 'delivered'
                         and delivered_at >= date_trunc('week', now())),
    'earnings_month', (select coalesce(sum(delivery_fee), 0) from orders
                       where driver_id = v_uid and status = 'delivered'
                         and delivered_at >= date_trunc('month', now())),
    'earnings_total', (select coalesce(sum(delivery_fee), 0) from orders
                       where driver_id = v_uid and status = 'delivered')
  );
end; $$;
