-- ============================================================
-- 027: Admin finance & monitoring RPCs
-- ============================================================

-- ── rpc_admin_get_financial_report ────────────────────────────
-- Completed orders only (delivered / picked_up_by_customer).
-- p_group_by: 'day' | 'month'
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

-- ── rpc_admin_get_unclaimed_orders ────────────────────────────
-- Delivery orders no driver has claimed and whose prep window has
-- already elapsed — surfaced as an alert in the dashboard.
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
