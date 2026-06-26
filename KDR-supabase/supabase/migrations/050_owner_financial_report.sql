-- ============================================================
-- 050: Owner financial report RPC
--
-- Powers the new "التقارير" tab on the owner profile screen. The
-- existing admin RPC (`rpc_admin_get_financial_report`) returns the
-- same shape but is admin-only and joins across every restaurant,
-- so we cannot reuse it directly: an owner must only ever see their
-- own restaurant's numbers, and we don't want to expose the admin
-- function via grant.
--
-- Returns:
--   totals      jsonb  — aggregated KPIs for the whole window
--   periods     jsonb  — array of {period, ...} bucketed by day,
--                       month, or year (decided by p_group_by)
--   meta        jsonb  — echoes the inputs so the client can show
--                       the current filter without round-tripping
--
-- Window bounds default to "last 30 days" so a no-arg call gives a
-- sane starting view. Group_by accepts 'day', 'month', 'year'; any
-- other value returns an error JSON.
-- ============================================================

create or replace function public.rpc_owner_get_financial_report(
  p_from     date default (current_date - interval '30 days')::date,
  p_to       date default current_date,
  p_group_by text default 'day'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_trunc   text;
  v_totals  jsonb;
  v_periods jsonb;
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  if p_group_by not in ('day', 'month', 'year') then
    return jsonb_build_object('error', 'group_by must be day, month, or year');
  end if;
  v_trunc := p_group_by;

  -- Window totals across delivered + picked-up orders only — cancelled
  -- and rejected ones never produced revenue and would bias the avgs.
  select jsonb_build_object(
    'orders_count',          count(*),
    'gross_sales',           coalesce(sum(total_amount), 0),
    'subtotal',              coalesce(sum(subtotal), 0),
    'discount',              coalesce(sum(discount), 0),
    'delivery_fees',         coalesce(sum(delivery_fee), 0),
    'platform_commission',   coalesce(sum(commission_amount), 0),
    'restaurant_revenue',    coalesce(sum(restaurant_revenue), 0),
    'self_delivery_count',   count(*) filter (where delivery_by_owner),
    'self_delivery_earnings',
      coalesce(sum(delivery_fee) filter (where delivery_by_owner), 0),
    -- "Net to owner" = food revenue after commission + delivery fees they
    -- kept on self-delivery orders. The headline number on the screen.
    'net_to_owner',
      coalesce(sum(restaurant_revenue), 0)
      + coalesce(sum(delivery_fee) filter (where delivery_by_owner), 0)
  ) into v_totals
  from orders
  where restaurant_id = v_rest_id
    and status in ('delivered', 'picked_up_by_customer')
    and created_at::date between p_from and p_to;

  select coalesce(jsonb_agg(t order by t.period), '[]'::jsonb) into v_periods
  from (
    select
      date_trunc(v_trunc, created_at)::date         as period,
      count(*)                                      as orders_count,
      coalesce(sum(total_amount), 0)                as gross_sales,
      coalesce(sum(commission_amount), 0)           as platform_commission,
      coalesce(sum(restaurant_revenue), 0)          as restaurant_revenue,
      coalesce(sum(delivery_fee) filter
        (where delivery_by_owner), 0)               as self_delivery_earnings,
      coalesce(sum(restaurant_revenue), 0)
        + coalesce(sum(delivery_fee) filter
          (where delivery_by_owner), 0)             as net_to_owner
    from orders
    where restaurant_id = v_rest_id
      and status in ('delivered', 'picked_up_by_customer')
      and created_at::date between p_from and p_to
    group by 1
  ) t;

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'from', p_from, 'to', p_to, 'group_by', p_group_by,
      'restaurant_id', v_rest_id
    ),
    'totals',  v_totals,
    'periods', v_periods
  );
end; $$;

grant execute on function public.rpc_owner_get_financial_report(date, date, text)
  to authenticated;
