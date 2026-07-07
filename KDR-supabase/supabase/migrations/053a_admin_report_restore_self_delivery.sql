-- ============================================================
-- 053a: Patch — 053 dropped self_delivery segmentation from
-- rpc_admin_get_financial_report by rewriting it without the
-- fields migration 044 added. Restore them alongside the new
-- commission-absorption fields so the admin finance page keeps
-- surfacing self-delivery counts + earnings.
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
    'orders_count',                count(*),
    'gross_sales',                 coalesce(sum(total_amount), 0),
    'subtotal',                    coalesce(sum(subtotal), 0),
    'discount',                    coalesce(sum(discount), 0),
    'commission_gross',            coalesce(sum(commission_gross), 0),
    'discount_absorbed_by_platform', coalesce(sum(discount_platform_share), 0),
    'discount_borne_by_restaurant',  coalesce(sum(discount_restaurant_share), 0),
    'platform_revenue',            coalesce(sum(commission_amount), 0),
    'restaurant_revenue',          coalesce(sum(restaurant_revenue), 0),
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
      date_trunc(v_trunc, created_at)::date          as period,
      count(*)                                       as orders_count,
      coalesce(sum(total_amount), 0)                 as gross_sales,
      coalesce(sum(discount), 0)                     as discount,
      coalesce(sum(commission_gross), 0)             as commission_gross,
      coalesce(sum(discount_platform_share), 0)      as discount_absorbed_by_platform,
      coalesce(sum(commission_amount), 0)            as platform_revenue,
      coalesce(sum(restaurant_revenue), 0)           as restaurant_revenue,
      count(*) filter (where delivery_by_owner)      as self_delivery_orders_count,
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
      r.id                                        as restaurant_id,
      r.name_ar, r.name_en,
      r.commission_percentage                     as current_commission_percentage,
      count(o.id)                                 as orders_count,
      coalesce(sum(o.total_amount), 0)            as gross_sales,
      coalesce(sum(o.discount), 0)                as discount,
      coalesce(sum(o.commission_gross), 0)        as commission_gross,
      coalesce(sum(o.discount_platform_share), 0) as discount_absorbed_by_platform,
      coalesce(sum(o.commission_amount), 0)       as platform_revenue,
      coalesce(sum(o.restaurant_revenue), 0)      as restaurant_revenue,
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
