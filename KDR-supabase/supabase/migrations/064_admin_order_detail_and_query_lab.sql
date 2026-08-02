-- ============================================================
-- 064: Admin order detail, guarded status transitions, and a
--      server-side query lab
--
-- Three unrelated-looking dashboard gaps that share one root
-- cause — the dashboard was reading tables straight from the
-- browser instead of going through an admin RPC:
--
--   1. Order detail. Every lifecycle timestamp we need is already
--      on `orders` (accepted_at / claimed_at / picked_up_at /
--      delivered_at) and every status flip is already journalled
--      into `order_status_history` by `trg_log_order_status`.
--      None of it reached the dashboard, because the orders page
--      does a bare `select *` with no joins — so there was no
--      customer name, no driver, no line items, no money split.
--      `rpc_admin_get_order_detail` returns the whole picture in
--      one round-trip, including per-stage durations.
--
--   2. Status changes. The dashboard PATCHed `orders.status`
--      directly, which RLS allows for admins but which lets an
--      order jump pending → delivered and leaves the milestone
--      timestamps NULL forever (they are written by the mobile
--      flows, not by a trigger). `rpc_admin_update_order_status`
--      validates the transition, stamps the matching timestamp,
--      and records the admin's note on the history row that
--      `trg_log_order_status` just wrote.
--
--   3. Query lab. Five of its eight queries were dead: they used
--      PostgREST aggregate syntax (`count:id.count()`), and
--      aggregates are disabled on this project, so every one of
--      them returned PGRST123 "Use of aggregate functions is not
--      allowed". Rather than switch that flag on — which would
--      let any authenticated client aggregate over whole tables —
--      the queries move server-side behind a whitelist key.
--
-- Also adds `rpc_admin_get_auth_providers`, because sign-in
-- provider counts live in `auth.identities`, which the anon key
-- cannot read at all. Needs SECURITY DEFINER to cross into the
-- auth schema.
--
-- Idempotent. Read-only except for rpc_admin_update_order_status.
-- ============================================================


-- ── 1) rpc_admin_get_order_detail ─────────────────────────────
-- Everything support needs to answer "where is my order?" without
-- opening five pages: parties, money, geography, milestones and
-- the full status journal.
--
-- Milestone durations are computed here rather than in the client
-- so the dashboard and any future report agree on what "time to
-- accept" means.
create or replace function public.rpc_admin_get_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  select jsonb_build_object(
    'id',          o.id,
    'status',      o.status,
    'order_type',  o.order_type,
    'created_at',  o.created_at,
    'updated_at',  o.updated_at,
    'notes',       o.notes,
    'rejection_reason', o.rejection_reason,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'delivery_by_owner', o.delivery_by_owner,

    -- Parties ------------------------------------------------
    'customer', jsonb_build_object(
      'id',        cu.id,
      'full_name', cu.full_name,
      'phone',     cu.phone,
      'alternate_phone', cu.alternate_phone
    ),
    'restaurant', jsonb_build_object(
      'id',      r.id,
      'name_ar', r.name_ar,
      'name_en', r.name_en,
      'logo_url', r.logo_url,
      'commission_percentage', r.commission_percentage,
      'self_delivery_enabled', r.self_delivery_enabled
    ),
    'branch', case when b.id is null then null else jsonb_build_object(
      'id',         b.id,
      'name_ar',    b.name_ar,
      'name_en',    b.name_en,
      'address_ar', b.address_ar,
      'address_en', b.address_en,
      'phones',     coalesce(
        (select jsonb_agg(bp.phone order by bp.phone) from branch_phones bp where bp.branch_id = b.id),
        '[]'::jsonb
      )
    ) end,
    -- NULL until a driver claims it; stays NULL forever on
    -- self-delivery and pickup orders.
    'driver', case when dr.id is null then null else jsonb_build_object(
      'id',        dr.id,
      'full_name', dr.full_name,
      'phone',     dr.phone
    ) end,

    -- Contact + geography ------------------------------------
    'contact_phone',    o.contact_phone,
    'alternate_phone',  o.alternate_phone,
    'delivery_address', o.delivery_address,
    'branch_lat',       o.branch_lat,
    'branch_lng',       o.branch_lng,
    'delivery_lat',     o.delivery_lat,
    'delivery_lng',     o.delivery_lng,
    'delivery_distance_km', o.delivery_distance_km,

    -- Money --------------------------------------------------
    -- `discount_platform_share` / `discount_restaurant_share` are
    -- the voucher split from migration 053: the platform's
    -- commission absorbs the discount first, the restaurant only
    -- eats the overflow.
    'money', jsonb_build_object(
      'subtotal',           o.subtotal,
      'delivery_fee',       o.delivery_fee,
      'discount',           o.discount,
      'total_amount',       o.total_amount,
      'commission_percentage', o.commission_percentage,
      'commission_gross',   o.commission_gross,
      'commission_amount',  o.commission_amount,
      'restaurant_revenue', o.restaurant_revenue,
      'discount_platform_share',   o.discount_platform_share,
      'discount_restaurant_share', o.discount_restaurant_share,
      -- The driver keeps the whole delivery fee (migration 045),
      -- and earns nothing when the restaurant delivers itself.
      'driver_earnings', case
        when o.driver_id is not null and not coalesce(o.delivery_by_owner, false)
        then o.delivery_fee else 0 end
    ),
    'voucher', case when v.id is null then null else jsonb_build_object(
      'id',             v.id,
      'code',           v.code,
      'discount_type',  v.discount_type,
      'discount_value', v.discount_value
    ) end,

    -- Line items ---------------------------------------------
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',            oi.id,
        'menu_item_id',  oi.menu_item_id,
        'item_name_ar',  oi.item_name_ar,
        'item_name_en',  oi.item_name_en,
        'price',         oi.price,
        'quantity',      oi.quantity,
        'line_total',    oi.price * oi.quantity,
        'special_instructions', oi.special_instructions
      ) order by oi.item_name_ar)
      from order_items oi where oi.order_id = o.id
    ), '[]'::jsonb),

    -- Milestones ---------------------------------------------
    -- Raw stamps plus the gap between each pair, in minutes, so
    -- the dashboard can render a timeline without doing date
    -- maths in the browser. A NULL duration means the stage has
    -- not happened (yet, or at all for this order type).
    'milestones', jsonb_build_object(
      'created_at',   o.created_at,
      'accepted_at',  o.accepted_at,
      'claimed_at',   o.claimed_at,
      'picked_up_at', o.picked_up_at,
      'delivered_at', o.delivered_at,
      'minutes_to_accept',
        round(extract(epoch from (o.accepted_at  - o.created_at))  / 60.0, 1),
      'minutes_to_claim',
        round(extract(epoch from (o.claimed_at   - o.accepted_at)) / 60.0, 1),
      'minutes_to_pickup',
        round(extract(epoch from (o.picked_up_at - o.claimed_at))  / 60.0, 1),
      'minutes_to_deliver',
        round(extract(epoch from (o.delivered_at - o.picked_up_at))/ 60.0, 1),
      'minutes_total',
        round(extract(epoch from (o.delivered_at - o.created_at))  / 60.0, 1)
    ),

    -- Rating + full status journal ---------------------------
    'rating', case when o.restaurant_rating is null then null else jsonb_build_object(
      'stars',    o.restaurant_rating,
      'review',   o.restaurant_review,
      'rated_at', o.rated_at
    ) end,
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',         h.id,
        'status',     h.status,
        'notes',      h.notes,
        'created_at', h.created_at,
        'changed_by', case when ch.id is null then null else jsonb_build_object(
          'id', ch.id, 'full_name', ch.full_name, 'role', ch.role
        ) end
      ) order by h.created_at)
      from order_status_history h
      left join profiles ch on ch.id = h.changed_by
      where h.order_id = o.id
    ), '[]'::jsonb)
  )
  into v_result
  from orders o
    join      restaurants r  on r.id  = o.restaurant_id
    join      profiles    cu on cu.id = o.user_id
    left join branches    b  on b.id  = o.branch_id
    left join profiles    dr on dr.id = o.driver_id
    left join vouchers    v  on v.id  = o.voucher_id
  where o.id = p_order_id;

  if v_result is null then
    return jsonb_build_object('error', 'Order not found');
  end if;

  return v_result;
end; $$;

grant execute on function public.rpc_admin_get_order_detail(uuid) to authenticated;


-- ── 2) rpc_admin_update_order_status ──────────────────────────
-- Guarded replacement for the dashboard's direct PATCH.
--
-- Two things the raw UPDATE could not do:
--   • Reject nonsense transitions (pending → delivered skipped
--     three stages and every timestamp with them).
--   • Stamp the milestone column that matches the new status.
--     Those columns are written by the mobile owner/driver flows;
--     an admin acting on someone's behalf has to fill them in too
--     or the order looks like it teleported.
--
-- `trg_log_order_status` writes the history row itself, so the
-- note is attached afterwards to the row it just created.
create or replace function public.rpc_admin_update_order_status(
  p_order_id uuid,
  p_status   text,
  p_notes    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current  order_status;
  v_next     order_status;
  v_type     order_type;
  v_allowed  order_status[];
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  select status, order_type into v_current, v_type
  from orders where id = p_order_id;

  if not found then
    return jsonb_build_object('error', 'Order not found');
  end if;

  begin
    v_next := p_status::order_status;
  exception when invalid_text_representation then
    return jsonb_build_object('error', format('Unknown status: %s', p_status));
  end;

  if v_next = v_current then
    return jsonb_build_object('error', 'Order is already in that status');
  end if;

  -- Transition table. Cancelling is available from any live
  -- status; the four terminal statuses accept nothing.
  v_allowed := case v_current
    when 'pending' then
      array['preparing', 'rejected', 'cancelled']::order_status[]
    when 'preparing' then
      case when v_type = 'pickup'
        then array['ready_for_pickup', 'cancelled']::order_status[]
        else array['ready_for_pickup', 'out_for_delivery', 'cancelled']::order_status[]
      end
    when 'ready_for_pickup' then
      case when v_type = 'pickup'
        then array['picked_up_by_customer', 'cancelled']::order_status[]
        else array['out_for_delivery', 'cancelled']::order_status[]
      end
    when 'out_for_delivery' then
      array['delivered', 'cancelled']::order_status[]
    else
      array[]::order_status[]   -- delivered / picked_up / rejected / cancelled
  end;

  if not (v_next = any(v_allowed)) then
    return jsonb_build_object(
      'error', format('Cannot move a %s order from %s to %s', v_type, v_current, v_next),
      'allowed', to_jsonb(v_allowed)
    );
  end if;

  -- Fill the milestone for the stage being entered, but never
  -- overwrite one the real flow already recorded.
  update orders set
    status       = v_next,
    accepted_at  = case when v_next = 'preparing'        then coalesce(accepted_at,  now()) else accepted_at  end,
    picked_up_at = case when v_next = 'out_for_delivery' then coalesce(picked_up_at, now()) else picked_up_at end,
    delivered_at = case
                     when v_next in ('delivered', 'picked_up_by_customer')
                     then coalesce(delivered_at, now())
                     else delivered_at
                   end,
    rejection_reason = case
                         when v_next = 'rejected' then coalesce(p_notes, rejection_reason)
                         else rejection_reason
                       end
  where id = p_order_id;

  -- Attach the admin's note to the history row the trigger just
  -- inserted for this transition.
  if p_notes is not null and length(btrim(p_notes)) > 0 then
    update order_status_history h
    set notes = p_notes
    where h.id = (
      select h2.id from order_status_history h2
      where h2.order_id = p_order_id
      order by h2.created_at desc
      limit 1
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'from',    v_current,
    'to',      v_next
  );
end; $$;

grant execute on function public.rpc_admin_update_order_status(uuid, text, text) to authenticated;


-- ── 3) rpc_admin_get_auth_providers ───────────────────────────
-- Sign-in provider mix. `auth.identities` is unreachable from the
-- anon/authenticated key, so this has to be SECURITY DEFINER.
--
-- One user can hold several identities (Apple today, Google
-- tomorrow), so two different counts are reported: `identities`
-- counts links, `primary_users` counts accounts by the provider
-- they signed up with. They will not add up to the same total,
-- and that difference is itself the interesting number.
--
-- Note that `email` here is not really email sign-up — it is the
-- synthetic-email scheme the WhatsApp OTP flow uses (see
-- migration 051), so it reads as "phone/OTP".
create or replace function public.rpc_admin_get_auth_providers()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  select jsonb_build_object(
    'providers', coalesce((
      select jsonb_agg(t order by t->>'identities' desc)
      from (
        select jsonb_build_object(
          'provider',      i.provider,
          'identities',    count(*),
          'primary_users', count(*) filter (
            where u.raw_app_meta_data->>'provider' = i.provider
          ),
          'active_7d', count(*) filter (
            where u.last_sign_in_at > now() - interval '7 days'
          ),
          'active_30d', count(*) filter (
            where u.last_sign_in_at > now() - interval '30 days'
          ),
          'new_30d', count(*) filter (
            where u.created_at > now() - interval '30 days'
          )
        ) as t
        from auth.identities i
        join auth.users u on u.id = i.user_id
        group by i.provider
      ) s
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'users',      count(*),
        'active_7d',  count(*) filter (where u.last_sign_in_at > now() - interval '7 days'),
        'active_30d', count(*) filter (where u.last_sign_in_at > now() - interval '30 days'),
        'new_30d',    count(*) filter (where u.created_at      > now() - interval '30 days'),
        -- Accounts that reached more than one provider.
        'multi_provider', (
          select count(*) from (
            select user_id from auth.identities group by user_id having count(*) > 1
          ) m
        )
      )
      from auth.users u
    )
  ) into v_result;

  return v_result;
end; $$;

grant execute on function public.rpc_admin_get_auth_providers() to authenticated;


-- ── 4) rpc_admin_run_named_query ──────────────────────────────
-- The query lab, moved server-side.
--
-- Deliberately a whitelist of keys rather than a SQL passthrough:
-- the dashboard runs under the admin's own JWT in the browser, so
-- "send arbitrary SQL to a SECURITY DEFINER function" would be a
-- privilege-escalation hole one XSS away. Adding a query means
-- adding a branch here.
--
-- Every branch returns a jsonb array of flat objects; the lab
-- renders whatever columns come back.
create or replace function public.rpc_admin_run_named_query(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  case p_key

    when 'top_restaurants' then
      select coalesce(jsonb_agg(t order by (t->>'orders')::int desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'restaurant', r.name_ar,
          'orders',     count(o.id),
          'delivered',  count(*) filter (where o.status = 'delivered'),
          'cancelled',  count(*) filter (where o.status in ('cancelled', 'rejected')),
          'revenue',    coalesce(sum(o.total_amount) filter (
                          where o.status not in ('cancelled', 'rejected')), 0),
          'avg_order',  round(coalesce(avg(o.total_amount) filter (
                          where o.status not in ('cancelled', 'rejected')), 0), 2)
        ) as t
        from restaurants r
          join orders o on o.restaurant_id = r.id
        group by r.id, r.name_ar
        order by count(o.id) desc
        limit 20
      ) s;

    when 'recent_orders' then
      select coalesce(jsonb_agg(t), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'order_id',   left(o.id::text, 8),
          'status',     o.status,
          'restaurant', r.name_ar,
          'customer',   cu.full_name,
          'total',      o.total_amount,
          'created_at', o.created_at
        ) as t
        from orders o
          join restaurants r  on r.id  = o.restaurant_id
          join profiles    cu on cu.id = o.user_id
        order by o.created_at desc
        limit 20
      ) s;

    when 'users_by_role' then
      select coalesce(jsonb_agg(t order by (t->>'total')::int desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'role',           p.role,
          'total',          count(*),
          'active',         count(*) filter (where p.is_active),
          'phone_verified', count(*) filter (where p.phone_verified_at is not null),
          'whatsapp_opt_in',count(*) filter (where p.whatsapp_opt_in),
          'new_30d',        count(*) filter (where p.created_at > now() - interval '30 days')
        ) as t
        from profiles p
        group by p.role
      ) s;

    when 'revenue_by_status' then
      select coalesce(jsonb_agg(t order by (t->>'orders')::int desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'status',       o.status,
          'orders',       count(*),
          'total',        coalesce(sum(o.total_amount), 0),
          'commission',   coalesce(sum(o.commission_amount), 0),
          'delivery_fees',coalesce(sum(o.delivery_fee), 0)
        ) as t
        from orders o
        group by o.status
      ) s;

    when 'menu_items_per_restaurant' then
      select coalesce(jsonb_agg(t order by (t->>'items')::int desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'restaurant', r.name_ar,
          'items',      count(m.id),
          'available',  count(*) filter (where m.is_available)
        ) as t
        from restaurants r
          left join menu_items m on m.restaurant_id = r.id
        group by r.id, r.name_ar
        order by count(m.id) desc
        limit 30
      ) s;

    when 'active_vouchers' then
      select coalesce(jsonb_agg(t), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'code',           v.code,
          'discount_type',  v.discount_type,
          'discount_value', v.discount_value,
          'used_count',     v.used_count,
          'usage_limit',    v.usage_limit,
          'valid_to',       v.valid_to,
          'expired',        v.valid_to < now()
        ) as t
        from vouchers v
        where v.is_active
        order by v.used_count desc
        limit 20
      ) s;

    when 'top_rated' then
      select coalesce(jsonb_agg(t order by (t->>'avg_rating')::numeric desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'restaurant', r.name_ar,
          'avg_rating', round(avg(o.restaurant_rating), 2),
          'ratings',    count(*),
          'five_star',  count(*) filter (where o.restaurant_rating = 5)
        ) as t
        from restaurants r
          join orders o on o.restaurant_id = r.id
        where o.restaurant_rating is not null
        group by r.id, r.name_ar
        order by avg(o.restaurant_rating) desc
        limit 20
      ) s;

    when 'orders_by_day' then
      select coalesce(jsonb_agg(t order by t->>'day' desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'day',       d::date,
          'orders',    count(o.id),
          'delivered', count(*) filter (where o.status = 'delivered'),
          'revenue',   coalesce(sum(o.total_amount) filter (
                         where o.status not in ('cancelled', 'rejected')), 0)
        ) as t
        from generate_series(
               (now() - interval '29 days')::date, now()::date, interval '1 day'
             ) d
          left join orders o on o.created_at::date = d::date
        group by d
      ) s;

    -- Where the delivery pipeline actually loses time. Only
    -- delivery orders that reached `delivered` have every stamp.
    when 'delivery_performance' then
      select coalesce(jsonb_agg(t order by (t->>'orders')::int desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'restaurant', r.name_ar,
          'orders',     count(*),
          'avg_accept_min',  round(avg(extract(epoch from (o.accepted_at  - o.created_at)))  / 60.0, 1),
          'avg_claim_min',   round(avg(extract(epoch from (o.claimed_at   - o.accepted_at))) / 60.0, 1),
          'avg_pickup_min',  round(avg(extract(epoch from (o.picked_up_at - o.claimed_at)))  / 60.0, 1),
          'avg_deliver_min', round(avg(extract(epoch from (o.delivered_at - o.picked_up_at)))/ 60.0, 1),
          'avg_total_min',   round(avg(extract(epoch from (o.delivered_at - o.created_at)))  / 60.0, 1)
        ) as t
        from orders o
          join restaurants r on r.id = o.restaurant_id
        where o.status = 'delivered' and o.delivered_at is not null
        group by r.id, r.name_ar
      ) s;

    when 'top_customers' then
      select coalesce(jsonb_agg(t order by (t->>'orders')::int desc), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'customer',   cu.full_name,
          'phone',      cu.phone,
          'orders',     count(*),
          'spent',      coalesce(sum(o.total_amount) filter (
                          where o.status not in ('cancelled', 'rejected')), 0),
          'last_order', max(o.created_at)
        ) as t
        from profiles cu
          join orders o on o.user_id = cu.id
        group by cu.id, cu.full_name, cu.phone
        order by count(*) desc
        limit 20
      ) s;

    when 'audit_summary' then
      select coalesce(jsonb_agg(t), '[]'::jsonb) into v_result
      from (
        select jsonb_build_object(
          'action',     a.action,
          'table',      a.table_name,
          'record_id',  left(a.record_id, 8),
          'user',       coalesce(p.full_name, 'النظام'),
          'created_at', a.created_at
        ) as t
        from audit_logs a
          left join profiles p on p.id = a.user_id
        order by a.created_at desc
        limit 30
      ) s;

    else
      return jsonb_build_object('error', format('Unknown query key: %s', p_key));
  end case;

  return jsonb_build_object('data', coalesce(v_result, '[]'::jsonb));
end; $$;

grant execute on function public.rpc_admin_run_named_query(text) to authenticated;
