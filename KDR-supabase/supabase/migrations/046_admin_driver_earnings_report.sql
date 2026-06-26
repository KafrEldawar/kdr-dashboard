-- ============================================================
-- 046: Admin per-driver earnings report
--
-- The owner already sees "self-delivery earnings" in the finance
-- module (migration 044). Now admins need the same lens for the
-- driver pool: who delivered how much, how often, when.
--
-- Compensation model (set in this session): the driver keeps the
-- full `delivery_fee` on every delivered order. No commission on
-- delivery — commission applies only to the food subtotal via
-- `restaurants.commission_percentage`.
-- ============================================================

create or replace function public.rpc_admin_get_driver_earnings_report(
  p_from      date default (current_date - interval '30 days')::date,
  p_to        date default current_date,
  p_driver_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_totals  jsonb;
  v_drivers jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  select jsonb_build_object(
    'drivers_count',
      count(distinct driver_id) filter (where driver_id is not null),
    'total_deliveries', count(*),
    'total_earnings',   coalesce(sum(delivery_fee), 0)
  ) into v_totals
  from orders
  where status = 'delivered'
    and driver_id is not null
    and delivery_by_owner = false
    and delivered_at::date between p_from and p_to
    and (p_driver_id is null or driver_id = p_driver_id);

  select coalesce(jsonb_agg(t order by t.earnings desc), '[]'::jsonb)
    into v_drivers
  from (
    select
      o.driver_id,
      p.full_name,
      p.phone,
      count(*)                                 as deliveries,
      coalesce(sum(o.delivery_fee), 0)         as earnings,
      coalesce(avg(o.delivery_fee), 0)         as avg_per_delivery,
      min(o.delivered_at)                      as first_delivery_at,
      max(o.delivered_at)                      as last_delivery_at
    from orders o
    left join profiles p on p.id = o.driver_id
    where o.status = 'delivered'
      and o.driver_id is not null
      and o.delivery_by_owner = false
      and o.delivered_at::date between p_from and p_to
      and (p_driver_id is null or o.driver_id = p_driver_id)
    group by o.driver_id, p.full_name, p.phone
  ) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', v_totals,
    'drivers', v_drivers
  );
end; $$;

grant execute on function public.rpc_admin_get_driver_earnings_report(date, date, uuid)
  to authenticated;
