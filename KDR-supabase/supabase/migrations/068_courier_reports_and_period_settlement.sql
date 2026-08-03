-- ============================================================
-- 068: Per-courier delivery reports + settlement over a period.
--
-- Why:
--   067 shipped settlement as "everything a rider still owes", which
--   answers the wrong question. What an office actually asks is
--   "how many orders did each rider do today / this week, what are they
--   worth, and let me close that period off". A single running balance
--   can't express that, and settling with no date bound silently closed
--   every open order at once.
--
--   These RPCs serve the individual rider too: with no couriers on the
--   account the breakdown comes back empty and the totals are simply
--   their own work, which is exactly their day book.
--
-- Dates:
--   All bucketing is done in Africa/Cairo, not UTC. `delivered_at` is a
--   timestamptz, so `::date` would push anything delivered after 22:00
--   Cairo into the next day and quietly misreport the daily close.
-- ============================================================

-- Period the settlement covered, so a past close can be read back as
-- "الأحد اتقفل" rather than just a timestamp and a number.
alter table public.provider_settlements
  add column if not exists period_from date,
  add column if not exists period_to   date;

-- ── 1. Report: totals + per-courier breakdown ────────────────
-- p_from / p_to are inclusive Cairo dates. Null means unbounded, so the
-- default call is "everything ever".
create or replace function public.rpc_provider_delivery_report(
  p_from date default null,
  p_to   date default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  return jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'totals', (
      select jsonb_build_object(
        'orders_count',      count(*),
        'collected',         coalesce(sum(coalesce(o.collected_amount, o.total_amount)), 0),
        'restaurant_paid',   coalesce(sum(o.subtotal - o.discount), 0),
        'delivery_fees',     coalesce(sum(o.delivery_fee), 0),
        'unsettled_orders',  count(*) filter (where o.settlement_id is null),
        'unsettled_amount',  coalesce(sum(
                               coalesce(o.collected_amount, o.total_amount) - (o.subtotal - o.discount)
                             ) filter (where o.settlement_id is null), 0)
      )
      from orders o
      where o.driver_id = v_uid
        and o.status = 'delivered'
        and (p_from is null or (o.delivered_at at time zone 'Africa/Cairo')::date >= p_from)
        and (p_to   is null or (o.delivered_at at time zone 'Africa/Cairo')::date <= p_to)
    ),
    -- One row per courier that did work in the window. Left-joined from
    -- the roster so an idle rider still shows with zeros rather than
    -- vanishing, which reads as "did they even work today?".
    'couriers', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.delivery_fees desc, t.full_name)
      from (
        select
          c.id,
          c.full_name,
          c.phone,
          c.is_active,
          count(o.id)                                                                   as orders_count,
          coalesce(sum(coalesce(o.collected_amount, o.total_amount)), 0)                 as collected,
          coalesce(sum(o.subtotal - o.discount), 0)                                      as restaurant_paid,
          coalesce(sum(o.delivery_fee), 0)                                               as delivery_fees,
          count(o.id) filter (where o.settlement_id is null)                             as unsettled_orders,
          coalesce(sum(
            coalesce(o.collected_amount, o.total_amount) - (o.subtotal - o.discount)
          ) filter (where o.settlement_id is null), 0)                                   as unsettled_amount
        from office_couriers c
        left join orders o
          on o.courier_id = c.id
         and o.driver_id  = v_uid
         and o.status     = 'delivered'
         and (p_from is null or (o.delivered_at at time zone 'Africa/Cairo')::date >= p_from)
         and (p_to   is null or (o.delivered_at at time zone 'Africa/Cairo')::date <= p_to)
        where c.office_id = v_uid
        group by c.id, c.full_name, c.phone, c.is_active
      ) t
    ), '[]'::jsonb),
    -- Orders the office took but never handed to a named rider. Without
    -- this line the per-courier numbers silently don't add up to the total.
    'unassigned', (
      select jsonb_build_object(
        'orders_count',  count(*),
        'delivery_fees', coalesce(sum(o.delivery_fee), 0),
        'unsettled_amount', coalesce(sum(
          coalesce(o.collected_amount, o.total_amount) - (o.subtotal - o.discount)
        ) filter (where o.settlement_id is null), 0)
      )
      from orders o
      where o.driver_id = v_uid
        and o.status = 'delivered'
        and o.courier_id is null
        and (p_from is null or (o.delivered_at at time zone 'Africa/Cairo')::date >= p_from)
        and (p_to   is null or (o.delivered_at at time zone 'Africa/Cairo')::date <= p_to)
    )
  );
end; $$;

revoke execute on function public.rpc_provider_delivery_report(date, date) from anon, public;

-- ── 2. Drill-down: one courier's orders in the window ────────
create or replace function public.rpc_provider_courier_orders(
  p_courier_id uuid default null,
  p_from       date default null,
  p_to         date default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  if p_courier_id is not null and not exists(
    select 1 from office_couriers where id = p_courier_id and office_id = v_uid
  ) then
    return jsonb_build_object('error', 'courier_not_found');
  end if;

  return jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',                o.id,
      'delivered_at',      o.delivered_at,
      'restaurant_name',   r.name_ar,
      'delivery_address',  o.delivery_address,
      'restaurant_payout', o.subtotal - o.discount,
      'collected',         coalesce(o.collected_amount, o.total_amount),
      'delivery_fee',      o.delivery_fee,
      'is_settled',        o.settlement_id is not null,
      'settled_at',        o.settled_at
    ) order by o.delivered_at desc)
    from orders o
    join restaurants r on r.id = o.restaurant_id
    where o.driver_id = v_uid
      and o.status = 'delivered'
      and (p_courier_id is null or o.courier_id = p_courier_id)
      and (p_from is null or (o.delivered_at at time zone 'Africa/Cairo')::date >= p_from)
      and (p_to   is null or (o.delivered_at at time zone 'Africa/Cairo')::date <= p_to)
  ), '[]'::jsonb));
end; $$;

revoke execute on function public.rpc_provider_courier_orders(uuid, date, date) from anon, public;

-- ── 3. Settle a period ───────────────────────────────────────
-- The 067 signature is dropped rather than overloaded: two functions of
-- the same name with different defaulted arguments is the PGRST203
-- ambiguity that broke checkout in migration 055.
drop function if exists public.rpc_provider_settle(uuid, numeric, text);

create or replace function public.rpc_provider_settle(
  p_courier_id      uuid    default null,
  p_from            date    default null,
  p_to              date    default null,
  p_received_amount numeric default null,
  p_note            text    default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_sum record;
  v_id  uuid;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  if p_courier_id is not null and not exists(
    select 1 from office_couriers where id = p_courier_id and office_id = v_uid
  ) then
    return jsonb_build_object('error', 'courier_not_found');
  end if;

  -- Pin and lock the exact set first. Summing and then updating by
  -- predicate would let an order delivered in between get stamped with
  -- this settlement without being counted in its totals.
  with locked as (
    select o.id
    from orders o
    where o.driver_id = v_uid
      and o.status = 'delivered'
      and o.settlement_id is null
      and (p_courier_id is null or o.courier_id = p_courier_id)
      and (p_from is null or (o.delivered_at at time zone 'Africa/Cairo')::date >= p_from)
      and (p_to   is null or (o.delivered_at at time zone 'Africa/Cairo')::date <= p_to)
    for update
  )
  select array_agg(locked.id) into v_ids from locked;

  if v_ids is null or array_length(v_ids, 1) is null then
    return jsonb_build_object('error', 'nothing_to_settle');
  end if;

  select
    count(*)                                                                                   as orders_count,
    coalesce(sum(coalesce(o.collected_amount, o.total_amount)), 0)                              as total_collected,
    coalesce(sum(o.subtotal - o.discount), 0)                                                   as total_restaurant_paid,
    coalesce(sum(o.delivery_fee), 0)                                                            as total_delivery_fees,
    coalesce(sum(coalesce(o.collected_amount, o.total_amount) - (o.subtotal - o.discount)), 0)  as expected
  into v_sum
  from orders o where o.id = any(v_ids);

  insert into provider_settlements (
    provider_id, courier_id, period_from, period_to, orders_count,
    total_collected, total_restaurant_paid, total_delivery_fees,
    expected_amount, received_amount, note, created_by
  ) values (
    v_uid, p_courier_id, p_from, p_to, v_sum.orders_count,
    v_sum.total_collected, v_sum.total_restaurant_paid, v_sum.total_delivery_fees,
    v_sum.expected, coalesce(p_received_amount, v_sum.expected), p_note, v_uid
  )
  returning id into v_id;

  update orders set
    settlement_id = v_id,
    settled_at    = now(),
    updated_at    = now()
  where id = any(v_ids);

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'provider_settlements', v_id::text,
    jsonb_build_object('courier_id', p_courier_id, 'orders', v_sum.orders_count,
                       'from', p_from, 'to', p_to));

  return jsonb_build_object(
    'id',              v_id,
    'orders_count',    v_sum.orders_count,
    'expected_amount', v_sum.expected,
    'received_amount', coalesce(p_received_amount, v_sum.expected)
  );
end; $$;

revoke execute on function public.rpc_provider_settle(uuid, date, date, numeric, text) from anon, public;

-- ── 4. Past closes ───────────────────────────────────────────
create or replace function public.rpc_provider_list_settlements(
  p_limit integer default 30
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  return jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',              s.id,
      'created_at',      s.created_at,
      'period_from',     s.period_from,
      'period_to',       s.period_to,
      'courier_id',      s.courier_id,
      'courier_name',    c.full_name,
      'orders_count',    s.orders_count,
      'expected_amount', s.expected_amount,
      'received_amount', s.received_amount,
      'difference',      s.difference,
      'note',            s.note
    ) order by s.created_at desc)
    from provider_settlements s
    left join office_couriers c on c.id = s.courier_id
    where s.provider_id = v_uid
    limit p_limit
  ), '[]'::jsonb));
end; $$;

revoke execute on function public.rpc_provider_list_settlements(integer) from anon, public;
