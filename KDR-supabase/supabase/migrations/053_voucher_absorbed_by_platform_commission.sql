-- ============================================================
-- 053: Voucher discount absorbed by platform commission
--
-- Old rule (migration 032): commission was charged on
--    net = subtotal - discount
-- which meant both parties shared the discount pain
-- proportionally to their share of the food price. Restaurants
-- did lose money every time a voucher was redeemed.
--
-- New rule: platform absorbs the discount out of its commission
-- FIRST. Only the overflow (discount > commission_gross) hits the
-- restaurant. When a 10%-commission restaurant sells a 100 EGP
-- order under a 10 EGP voucher, the platform now earns 0 on that
-- order and the restaurant still gets its usual 90 EGP.
--
-- Given:
--   S = subtotal
--   P = commission_percentage
--   D = discount
--   G = commission_gross    = round(S × P / 100, 2)
-- Then:
--   platform_absorbed       = min(D, G)
--   restaurant_absorbed     = max(D - G, 0)
--   commission_amount (net) = G - platform_absorbed   = max(G - D, 0)
--   restaurant_revenue      = (S - D) - commission_amount
--
-- Reporting: dashboards + owner reports now surface both the gross
-- commission (what the platform "would have" earned) and how much
-- of it was absorbed to fund vouchers, so admins can see the true
-- cost of promotions.
-- ============================================================

-- ── 1) Snapshot columns on orders ────────────────────────────
alter table public.orders
  add column if not exists commission_gross          numeric(10,2),
  add column if not exists discount_platform_share   numeric(10,2),
  add column if not exists discount_restaurant_share numeric(10,2);

-- Backfill historical rows so downstream queries can rely on the
-- columns being non-null. Uses the OLD-formula math which shared
-- the discount pain proportionally: the platform's share of the
-- old discount was (discount × commission_pct / 100), and the
-- rest hit the restaurant. commission_gross is what the commission
-- WOULD have been on the full subtotal without a discount.
update public.orders set
  commission_gross          = round(subtotal * commission_percentage / 100, 2),
  discount_platform_share   = round(discount * commission_percentage / 100, 2),
  discount_restaurant_share = greatest(
    discount - round(discount * commission_percentage / 100, 2), 0)
where commission_gross is null;

alter table public.orders
  alter column commission_gross          set not null,
  alter column commission_gross          set default 0,
  alter column discount_platform_share   set not null,
  alter column discount_platform_share   set default 0,
  alter column discount_restaurant_share set not null,
  alter column discount_restaurant_share set default 0;


-- ── 2) rpc_checkout v4 — platform absorbs voucher first ──────
drop function if exists public.rpc_checkout(uuid, uuid, text, text, text, text, text);
create function public.rpc_checkout(
  p_delivery_address_id uuid    default null,
  p_branch_id           uuid    default null,
  p_contact_phone       text    default null,
  p_notes               text    default null,
  p_voucher_code        text    default null,
  p_order_type          text    default 'delivery',
  p_delivery_address    text    default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid    := auth.uid();
  v_cart_id      uuid;
  v_rest_id      uuid;
  v_subtotal     numeric(10,2) := 0;
  v_discount     numeric(10,2) := 0;
  v_total        numeric(10,2);
  v_voucher      record;
  v_voucher_id   uuid    := null;
  v_order_id     uuid;
  v_order_type   public.order_type;
  v_comm_pct     numeric(5,2) := 0;
  v_comm_gross   numeric(10,2);
  v_comm_amount  numeric(10,2);
  v_platform_share numeric(10,2);
  v_rest_share   numeric(10,2);
  v_rest_revenue numeric(10,2);

  v_branch_id    uuid;
  v_branch_count integer;
  v_branch_lat   double precision;
  v_branch_lng   double precision;

  v_addr_id      uuid;
  v_addr_text    text;
  v_addr_lat     double precision;
  v_addr_lng     double precision;

  v_fee_row      record;
  v_delivery_fee numeric(10,2) := 0;
  v_distance_km  numeric(6,2)  := null;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  begin
    v_order_type := p_order_type::public.order_type;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid order type: ' || p_order_type);
  end;

  if p_contact_phone is null or p_contact_phone = '' then
    return jsonb_build_object('error', 'Contact phone is required');
  end if;

  select id into v_cart_id from carts where user_id = v_uid;
  if v_cart_id is null or not exists (select 1 from cart_items where cart_id = v_cart_id) then
    return jsonb_build_object('error', 'Cart is empty');
  end if;

  select mi.restaurant_id, sum(ci.quantity * mi.price)
  into v_rest_id, v_subtotal
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id
  group by mi.restaurant_id;

  -- ── Delivery-specific validation + fee computation ──────────
  if v_order_type = 'delivery' then
    if p_branch_id is not null then
      select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
      from branches where id = p_branch_id and restaurant_id = v_rest_id;
      if v_branch_id is null then
        return jsonb_build_object('error', 'Invalid branch for this restaurant');
      end if;
    else
      select count(*) into v_branch_count from branches where restaurant_id = v_rest_id;
      if v_branch_count = 1 then
        select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
        from branches where restaurant_id = v_rest_id;
      else
        return jsonb_build_object('error', 'branch_id is required when the restaurant has multiple branches');
      end if;
    end if;

    if p_delivery_address_id is not null then
      select id, address_ar, lat, lng
      into v_addr_id, v_addr_text, v_addr_lat, v_addr_lng
      from user_addresses where id = p_delivery_address_id and user_id = v_uid;
      if v_addr_id is null then
        return jsonb_build_object('error', 'Address not found or access denied');
      end if;
    elsif p_delivery_address is not null and p_delivery_address <> '' then
      v_addr_text := p_delivery_address;
    else
      return jsonb_build_object('error', 'Delivery address is required for delivery orders');
    end if;

    if v_branch_lat is not null and v_branch_lng is not null
       and v_addr_id is not null and v_addr_lat is not null and v_addr_lng is not null then
      select * into v_fee_row from compute_delivery_fee(v_branch_id, v_addr_id);
      if v_fee_row.needs_pin then
        return jsonb_build_object('error', 'address_needs_pin');
      end if;
      if not v_fee_row.in_range then
        return jsonb_build_object('error', 'address_out_of_range');
      end if;
      v_delivery_fee := v_fee_row.fee;
      v_distance_km  := v_fee_row.distance_km;
    else
      return jsonb_build_object('error', 'address_needs_pin');
    end if;
  end if;

  -- ── Voucher ─────────────────────────────────────────────────
  if p_voucher_code is not null and p_voucher_code <> '' then
    select * into v_voucher
    from vouchers
    where code = p_voucher_code and restaurant_id = v_rest_id
      and is_active = true and valid_from <= now() and valid_to >= now();

    if not found then
      return jsonb_build_object('error', 'Invalid or expired voucher code');
    end if;
    if v_voucher.usage_limit is not null and v_voucher.used_count >= v_voucher.usage_limit then
      return jsonb_build_object('error', 'Voucher usage limit reached');
    end if;
    if v_subtotal < v_voucher.min_order_amount then
      return jsonb_build_object('error',
        format('Minimum order amount for this voucher is %s', v_voucher.min_order_amount));
    end if;

    v_voucher_id := v_voucher.id;
    v_discount := round(
      case when v_voucher.discount_type = 'percentage'
        then (v_subtotal * v_voucher.discount_value) / 100
        else v_voucher.discount_value end,
      2);
    -- Never let a voucher discount exceed the food value.
    v_discount := least(v_discount, v_subtotal);

    update vouchers set used_count = used_count + 1 where id = v_voucher_id;
  end if;

  v_total := greatest(v_subtotal - v_discount, 0) + v_delivery_fee;

  -- ── Commission split (v3 formula: platform absorbs first) ───
  select commission_percentage into v_comm_pct from restaurants where id = v_rest_id;
  v_comm_pct       := coalesce(v_comm_pct, 0);
  v_comm_gross     := round(v_subtotal * v_comm_pct / 100, 2);
  v_platform_share := least(v_discount, v_comm_gross);
  v_rest_share     := greatest(v_discount - v_comm_gross, 0);
  v_comm_amount    := v_comm_gross - v_platform_share;
  v_rest_revenue   := greatest(v_subtotal - v_discount - v_comm_amount, 0);

  insert into orders (
    user_id, restaurant_id, status, order_type,
    delivery_address, contact_phone, notes,
    subtotal, delivery_fee, discount, total_amount,
    commission_percentage, commission_gross, commission_amount,
    discount_platform_share, discount_restaurant_share,
    restaurant_revenue,
    voucher_id,
    branch_id, delivery_address_id,
    branch_lat, branch_lng,
    delivery_lat, delivery_lng,
    delivery_distance_km
  ) values (
    v_uid, v_rest_id, 'pending', v_order_type,
    case when v_order_type = 'delivery' then v_addr_text else null end,
    p_contact_phone, p_notes,
    v_subtotal, v_delivery_fee, v_discount, v_total,
    v_comm_pct, v_comm_gross, v_comm_amount,
    v_platform_share, v_rest_share,
    v_rest_revenue,
    v_voucher_id,
    v_branch_id, v_addr_id,
    v_branch_lat, v_branch_lng,
    v_addr_lat, v_addr_lng,
    v_distance_km
  )
  returning id into v_order_id;

  insert into order_items (order_id, menu_item_id, item_name_en, item_name_ar, price, quantity, special_instructions)
  select v_order_id, ci.menu_item_id, mi.name_en, mi.name_ar, mi.price, ci.quantity, ci.special_instructions
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id;

  delete from cart_items where cart_id = v_cart_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'orders', v_order_id::text,
    jsonb_build_object(
      'total',                     v_total,
      'restaurant_id',             v_rest_id,
      'order_type',                v_order_type,
      'branch_id',                 v_branch_id,
      'delivery_fee',              v_delivery_fee,
      'distance_km',               v_distance_km,
      'commission_gross',          v_comm_gross,
      'commission_amount',         v_comm_amount,
      'discount_platform_share',   v_platform_share,
      'discount_restaurant_share', v_rest_share
    ));

  return public.rpc_get_order_detail(v_order_id);
end; $$;

grant execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text) to authenticated;


-- ── 3) owner_order_json + driver_order_json surface splits ───
-- The owner mobile bill card wants to render the true breakdown
-- (subtotal − commission − restaurant's share of discount), and the
-- driver detail doesn't need the split but shouldn't break if fields
-- appear. We only need to touch owner_order_json here.
create or replace function public.owner_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                        o.id,
    'status',                    o.status,
    'order_type',                o.order_type,
    'delivery_by_owner',         o.delivery_by_owner,
    'total_amount',              o.total_amount,
    'subtotal',                  o.subtotal,
    'delivery_fee',              o.delivery_fee,
    'discount',                  o.discount,
    'commission_percentage',     o.commission_percentage,
    'commission_gross',          o.commission_gross,
    'commission_amount',         o.commission_amount,
    'discount_platform_share',   o.discount_platform_share,
    'discount_restaurant_share', o.discount_restaurant_share,
    'restaurant_revenue',        o.restaurant_revenue,
    'delivery_address',          o.delivery_address,
    'contact_phone',             o.contact_phone,
    'alternate_phone',           o.alternate_phone,
    'notes',                     o.notes,
    'accepted_at',               o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'rejection_reason',          o.rejection_reason,
    'picked_up_at',              o.picked_up_at,
    'delivered_at',              o.delivered_at,
    'created_at',                o.created_at,
    'updated_at',                o.updated_at,
    'items_count',               (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',                  jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
    'driver', case when o.driver_id is null then null else (
      select jsonb_build_object('id', d.id, 'full_name', d.full_name, 'phone', d.phone)
      from profiles d where d.id = o.driver_id
    ) end,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                   oi.id,
          'name_ar',              oi.item_name_ar,
          'name_en',              oi.item_name_en,
          'price',                oi.price,
          'quantity',             oi.quantity,
          'special_instructions', oi.special_instructions
        )
      ), '[]'::jsonb)
      from order_items oi where oi.order_id = o.id
    )
  )
  from orders o left join profiles p on p.id = o.user_id
  where o.id = p_order_id;
$$;

revoke execute on function public.owner_order_json(uuid) from anon, public;


-- ── 4) rpc_admin_get_financial_report v2 — surface absorption ─
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
    'restaurant_revenue',          coalesce(sum(restaurant_revenue), 0)
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
      coalesce(sum(restaurant_revenue), 0)           as restaurant_revenue
    from orders
    where status in ('delivered', 'picked_up_by_customer')
      and created_at::date between p_from and p_to
      and (p_restaurant_id is null or restaurant_id = p_restaurant_id)
    group by 1
  ) t;

  select coalesce(jsonb_agg(t order by t.platform_revenue desc), '[]'::jsonb) into v_by_rest
  from (
    select
      r.id                                      as restaurant_id,
      r.name_ar, r.name_en,
      r.commission_percentage                   as current_commission_percentage,
      count(o.id)                               as orders_count,
      coalesce(sum(o.total_amount), 0)          as gross_sales,
      coalesce(sum(o.discount), 0)              as discount,
      coalesce(sum(o.commission_gross), 0)      as commission_gross,
      coalesce(sum(o.discount_platform_share), 0) as discount_absorbed_by_platform,
      coalesce(sum(o.commission_amount), 0)     as platform_revenue,
      coalesce(sum(o.restaurant_revenue), 0)    as restaurant_revenue
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


-- ── 5) rpc_owner_get_financial_report v2 — surface absorption ─
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

  select jsonb_build_object(
    'orders_count',                count(*),
    'gross_sales',                 coalesce(sum(total_amount), 0),
    'subtotal',                    coalesce(sum(subtotal), 0),
    'discount',                    coalesce(sum(discount), 0),
    'delivery_fees',               coalesce(sum(delivery_fee), 0),
    'platform_commission',         coalesce(sum(commission_amount), 0),
    -- What the platform funded on the owner's behalf. Useful on the
    -- owner report so the restaurant sees how much promotional value
    -- Kafr al-Dawar (the platform) is giving their customers.
    'discount_absorbed_by_platform',
      coalesce(sum(discount_platform_share), 0),
    'discount_borne_by_restaurant',
      coalesce(sum(discount_restaurant_share), 0),
    'restaurant_revenue',          coalesce(sum(restaurant_revenue), 0),
    'self_delivery_count',         count(*) filter (where delivery_by_owner),
    'self_delivery_earnings',
      coalesce(sum(delivery_fee) filter (where delivery_by_owner), 0),
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
      coalesce(sum(discount), 0)                    as discount,
      coalesce(sum(discount_platform_share), 0)     as discount_absorbed_by_platform,
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
