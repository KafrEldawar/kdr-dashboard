-- ============================================================
-- 070: Stop counting the rider's delivery fee as restaurant money.
--
-- Why:
--   `rpc_owner_get_dashboard` computed revenue_today as sum(total_amount).
--   total_amount is the CUSTOMER's bill — it includes the delivery fee,
--   which on a rider-delivered order belongs to the rider and never
--   reaches the restaurant. A 400 EGP food order with a 32 EGP fee was
--   reported to the owner as 432 "مبيعات اليوم".
--
--   Same reason the recent-orders list looked wrong: it only carried
--   total_amount, so the card had no way to show the real figure.
--
--   Self-delivery and pickup are different: there is no rider in between,
--   so the whole bill is the restaurant's and total_amount is correct.
--   That is exactly what the CASE below encodes.
--
-- Note: self_delivery_earnings_* already report the fee separately for
--   self-delivered orders, so those stay as they are — the fee is counted
--   once, in the bucket where it was actually earned.
-- ============================================================

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

      -- What the restaurant actually takes in, not what the customer paid.
      'revenue_today',   (select coalesce(sum(
                            case
                              when o.delivery_by_owner or o.order_type = 'pickup'
                                then o.total_amount
                              else o.subtotal - o.discount
                            end
                          ), 0)
                          from orders o
                          where o.restaurant_id = v_rest_id
                            and o.created_at::date = current_date
                            and o.status <> 'cancelled'),

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
      --
      -- Now also carries the components the card needs to show the
      -- restaurant-facing amount instead of the customer's bill.
      (select jsonb_agg(jsonb_build_object(
         'id', sub.id, 'status', sub.status, 'total_amount', sub.total_amount,
         'subtotal', sub.subtotal,
         'discount', sub.discount,
         'delivery_by_owner', sub.delivery_by_owner,
         'order_type', sub.order_type,
         'created_at', sub.created_at,
         'customer_name', (select p.full_name from profiles p where p.id = sub.user_id)
       ) order by sub.created_at desc)
       from (
         select id, status, total_amount, subtotal, discount,
                delivery_by_owner, order_type, created_at, user_id
         from orders
         where restaurant_id = v_rest_id
         order by created_at desc
         limit 10
       ) sub),
      '[]'::jsonb
    )
  );
end; $$;

revoke execute on function public.rpc_owner_get_dashboard() from anon, public;
