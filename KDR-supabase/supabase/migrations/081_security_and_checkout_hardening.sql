-- ============================================================
-- 081: Security + checkout hardening (project review 2026-11-14)
-- ============================================================
--
-- One migration for the database half of the review. Every section is
-- independent and idempotent, so it is safe to re-run.
--
--   1. admin_auth_user_id_by_email()  — exact auth-user lookup for the
--      edge functions (replaces a listUsers scan capped at 200 users).
--   2. Drop "insert for anyone" RLS policies on order_items,
--      user_notifications and audit_logs, and the policy that exposed
--      every user's favourites.
--   3. Privileged profile columns (role, is_tester, phone,
--      phone_verified_at) can no longer be written straight through the
--      REST API, and rpc_update_profile no longer changes the phone.
--   4. rpc_checkout re-checks the cart at order time (one restaurant;
--      item / size / add-on still available), stores the branch for
--      pickup orders too, and locks the voucher row it counts against.
--   5. A cancelled or rejected order gives its voucher use back.
--   6. A voucher can be used once per customer (rpc_validate_voucher +
--      rpc_checkout). A cancelled / rejected order doesn't count.
--
-- How to apply: Supabase MCP `apply_migration` (or `supabase db query
-- --linked -f`), project rkhygtgmcurwemuzizep. Verification queries are at
-- the bottom of this file.
-- ============================================================


-- ── 1) Exact auth-user lookup for the edge functions ─────────
-- _shared/session.ts resolves "which account holds this synthetic email"
-- by asking for it directly instead of scanning listUsers() pages. It
-- reads auth.users, so it is service_role-only: no end user may probe
-- which emails exist.
create or replace function public.admin_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;

revoke execute on function public.admin_auth_user_id_by_email(text) from public, anon, authenticated;
grant  execute on function public.admin_auth_user_id_by_email(text) to service_role;


-- ── 2) RLS policies that let anyone write or read too much ───
-- Migration 005 added "insert via rpc" policies with `with check (true)`.
-- They were never needed — every function that writes these tables is
-- SECURITY DEFINER (owner bypasses RLS) and the edge functions use the
-- service role — but they let any signed-in user (or anon, where table
-- grants allow it) write rows directly:
--   * order_items        — add items, at any price, to someone else's order
--   * user_notifications — push fake in-app notifications to any user
--   * audit_logs         — forge the admin audit trail
drop policy if exists "order_items: insert via rpc"        on public.order_items;
drop policy if exists "user_notifications: insert allowed" on public.user_notifications;
drop policy if exists "audit_logs: insert via rpc"          on public.audit_logs;

-- 017's "public count visible" (`using (true)`) exposed the full
-- user ↔ restaurant favourites list. The app only reads its own rows
-- ("favorites: user manages own" covers that, admins included).
drop policy if exists "favorites: public count visible" on public.user_favorite_restaurants;


-- ── 3) Privileged profile columns ────────────────────────────
-- "profiles: user updates own" (005) stops a user changing their role,
-- but nothing stopped a direct PATCH of is_tester, phone or
-- phone_verified_at. That allowed:
--   * self-flagging as a tester (sees test restaurants, which are exempt
--     from the platform-wide ordering pause);
--   * setting any unclaimed phone with no verification. Login resolves an
--     account by profiles.phone, so whoever later verifies that number
--     would be signed into the squatter's account.
--
-- The guard only applies to end users writing through the API
-- (current_user = authenticated/anon). SECURITY DEFINER RPCs run as their
-- owner, edge functions as service_role, and admins keep full control.
create or replace function public.tg_profiles_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- is_admin() is not executable by anon (007), so only ask it for a
  -- signed-in caller. (anon can't reach this row through RLS anyway.)
  if current_user = 'authenticated' and public.is_admin() then
    return new;
  end if;

  if new.role              is distinct from old.role
  or new.is_tester         is distinct from old.is_tester
  or new.phone             is distinct from old.phone
  or new.phone_verified_at is distinct from old.phone_verified_at then
    raise exception 'privileged_profile_column'
      using errcode = '42501',
            hint    = 'Phone changes go through phone verification; role and tester flags are admin-only.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_privileged_columns on public.profiles;
create trigger trg_profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.tg_profiles_guard_privileged_columns();

-- rpc_update_profile (051) accepted p_phone and wrote it with no
-- verification — the same squatting hole through an RPC. The app's
-- profile form shows the phone read-only and sends the current value
-- back, so an *unchanged* phone is accepted as a no-op; a different one
-- is refused. Phones change only through verify-otp / wasage-complete /
-- firebase-phone-complete.
create or replace function public.rpc_update_profile(
  p_full_name  text default null,
  p_phone      text default null,
  p_gender     text default null,
  p_avatar_url text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_phone_in   text;
  v_phone_e164 text;
  v_current    text;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  v_phone_in := nullif(trim(coalesce(p_phone, '')), '');

  if v_phone_in is not null then
    v_phone_e164 := public.normalize_eg_phone(v_phone_in);
    if v_phone_e164 is null then
      return jsonb_build_object('error', 'invalid_phone');
    end if;

    select phone into v_current from public.profiles where id = v_uid;
    if public.normalize_eg_phone(v_current) is distinct from v_phone_e164 then
      return jsonb_build_object('error', 'phone_change_requires_verification');
    end if;
  end if;

  update profiles set
    full_name  = coalesce(p_full_name,  full_name),
    gender     = case when p_gender is not null then p_gender::gender_type else gender end,
    avatar_url = coalesce(p_avatar_url, avatar_url),
    updated_at = now()
  where id = v_uid;

  return public.rpc_get_my_profile();
end; $$;

grant execute on function public.rpc_update_profile(text, text, text, text) to authenticated;


-- ── 3b) Helper: has this customer already used this voucher? ─
-- Used by rpc_checkout (4) and rpc_validate_voucher (6), so it is
-- defined first. An order counts while it
-- is alive; a cancelled or rejected one gives the customer the code back
-- (matching the used_count refund in section 5).
create or replace function public.voucher_used_by(p_voucher_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from orders o
    where o.voucher_id = p_voucher_id
      and o.user_id    = p_user_id
      and o.status::text not in ('cancelled', 'rejected')
  );
$$;

revoke execute on function public.voucher_used_by(uuid, uuid) from public, anon, authenticated;

create index if not exists idx_orders_user_voucher
  on public.orders (user_id, voucher_id)
  where voucher_id is not null;


-- ── 4) rpc_checkout — re-check the cart at order time ────────
-- Based on the 078 version (fee from compute_delivery_fee, branch-pin vs
-- address-pin split, 053 commission split). Changes:
--   a. A cart spanning two restaurants is refused (`cart_conflict`). The
--      old aggregate `select … into … group by restaurant_id` silently took
--      whichever restaurant came first and priced only its items.
--   b. Items, sizes and add-ons are re-checked for availability. rpc_add_to_cart
--      checks them, but anything switched off *after* it went into the cart
--      used to be ordered anyway (only sizes were re-checked).
--   c. The branch is resolved for pickup orders too. Pickup orders were
--      stored with branch_id = null, so a multi-branch restaurant could
--      not tell where the customer was coming. An older app that sends no
--      branch for pickup at a multi-branch restaurant still gets through
--      (branch stays null, as before) — only delivery requires it.
--   d. The voucher row is locked (`for update`) so two simultaneous
--      checkouts cannot both pass the usage-limit check.
--   e. One use per customer (`voucher_already_used`) — see section 6.
create or replace function public.rpc_checkout(
  p_delivery_address_id uuid    default null,
  p_branch_id           uuid    default null,
  p_contact_phone       text    default null,
  p_notes               text    default null,
  p_voucher_code        text    default null,
  p_order_type          text    default 'delivery',
  p_delivery_address    text    default null,
  p_alternate_phone     text    default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid    := auth.uid();
  v_cart_id      uuid;
  v_rest_id      uuid;
  v_rest_count   integer;
  v_rest         record;
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

  v_alt_phone    text;
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

  v_alt_phone := nullif(trim(coalesce(p_alternate_phone, '')), '');

  select id into v_cart_id from carts where user_id = v_uid;
  if v_cart_id is null or not exists (select 1 from cart_items where cart_id = v_cart_id) then
    return jsonb_build_object('error', 'Cart is empty');
  end if;

  -- (a) one restaurant per order
  select count(distinct mi.restaurant_id), min(mi.restaurant_id::text)::uuid
  into v_rest_count, v_rest_id
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id;
  if v_rest_count = 0 then
    return jsonb_build_object('error', 'Cart is empty');
  end if;
  if v_rest_count > 1 then
    return jsonb_build_object('error', 'cart_conflict');
  end if;

  select accepts_online_orders, is_accepting_orders
  into v_rest from restaurants where id = v_rest_id;
  if not coalesce(v_rest.accepts_online_orders, false)
     or not coalesce(v_rest.is_accepting_orders, false) then
    return jsonb_build_object('error', 'not_accepting_orders');
  end if;

  -- (b) everything in the cart must still be orderable
  if exists (
    select 1 from cart_items ci
    join menu_items mi on mi.id = ci.menu_item_id
    where ci.cart_id = v_cart_id and not coalesce(mi.is_available, true)
  ) then
    return jsonb_build_object('error', 'item_unavailable');
  end if;

  if exists (
    select 1 from cart_items ci
    join menu_item_variants v on v.id = ci.variant_id
    where ci.cart_id = v_cart_id and not v.is_available
  ) then
    return jsonb_build_object('error', 'variant_unavailable');
  end if;

  if exists (
    select 1
    from cart_items ci
    cross join lateral unnest(coalesce(ci.addon_ids, '{}'::uuid[])) as picked(addon_id)
    join menu_addons a on a.id = picked.addon_id
    where ci.cart_id = v_cart_id and not a.is_available
  ) then
    return jsonb_build_object('error', 'addon_unavailable');
  end if;

  select sum(ci.quantity * public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids))
  into v_subtotal
  from cart_items ci
  where ci.cart_id = v_cart_id;

  -- (c) branch — required for delivery, recorded for pickup
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
    elsif v_order_type = 'delivery' then
      return jsonb_build_object('error', 'branch_id is required when the restaurant has multiple branches');
    end if;
  end if;

  -- ── Delivery-specific validation + fee computation ──────────
  if v_order_type = 'delivery' then
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

    -- The branch and the address are two separate reasons to refuse.
    if v_branch_lat is null or v_branch_lng is null then
      return jsonb_build_object('error', 'branch_needs_pin');
    end if;
    if v_addr_id is null or v_addr_lat is null or v_addr_lng is null then
      return jsonb_build_object('error', 'address_needs_pin');
    end if;

    select * into v_fee_row from compute_delivery_fee(v_branch_id, v_addr_id);
    if v_fee_row.needs_pin then
      return jsonb_build_object('error', 'address_needs_pin');
    end if;
    if v_fee_row.branch_needs_pin then
      return jsonb_build_object('error', 'branch_needs_pin');
    end if;
    if not v_fee_row.in_range then
      return jsonb_build_object('error', 'address_out_of_range');
    end if;
    v_delivery_fee := v_fee_row.fee;
    v_distance_km  := v_fee_row.distance_km;
  end if;

  -- ── Voucher ─────────────────────────────────────────────────
  if p_voucher_code is not null and p_voucher_code <> '' then
    -- (d) lock the row: the usage-limit check and the increment below
    -- must not interleave with another checkout using the same code.
    select * into v_voucher
    from vouchers
    where code = p_voucher_code and restaurant_id = v_rest_id
      and is_active = true and valid_from <= now() and valid_to >= now()
    for update;

    if not found then
      return jsonb_build_object('error', 'Invalid or expired voucher code');
    end if;
    if v_voucher.usage_limit is not null and v_voucher.used_count >= v_voucher.usage_limit then
      return jsonb_build_object('error', 'Voucher usage limit reached');
    end if;
    -- (e) once per customer. The row lock above serialises two checkouts
    -- by the same user, so the second one sees the first one's order.
    if public.voucher_used_by(v_voucher.id, v_uid) then
      return jsonb_build_object('error', 'voucher_already_used');
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
    v_discount := least(v_discount, v_subtotal);

    update vouchers set used_count = used_count + 1 where id = v_voucher_id;
  end if;

  v_total := greatest(v_subtotal - v_discount, 0) + v_delivery_fee;

  -- ── Commission split (053 formula: platform absorbs first) ──
  select commission_percentage into v_comm_pct from restaurants where id = v_rest_id;
  v_comm_pct       := coalesce(v_comm_pct, 0);
  v_comm_gross     := round(v_subtotal * v_comm_pct / 100, 2);
  v_platform_share := least(v_discount, v_comm_gross);
  v_rest_share     := greatest(v_discount - v_comm_gross, 0);
  v_comm_amount    := v_comm_gross - v_platform_share;
  v_rest_revenue   := greatest(v_subtotal - v_discount - v_comm_amount, 0);

  insert into orders (
    user_id, restaurant_id, status, order_type,
    delivery_address, contact_phone, alternate_phone, notes,
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
    p_contact_phone, v_alt_phone, p_notes,
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

  insert into order_items (
    order_id, menu_item_id, item_name_en, item_name_ar,
    price, base_price, quantity, special_instructions,
    variant_id, variant_name_ar, variant_name_en, addons
  )
  select
    v_order_id,
    ci.menu_item_id,
    mi.name_en || coalesce(' — ' || v.name_en, ''),
    mi.name_ar || coalesce(' — ' || v.name_ar, ''),
    public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids),
    coalesce(v.price, mi.price),
    ci.quantity,
    ci.special_instructions,
    ci.variant_id, v.name_ar, v.name_en,
    public._addons_json(ci.addon_ids)
  from cart_items ci
  join menu_items mi on mi.id = ci.menu_item_id
  left join menu_item_variants v on v.id = ci.variant_id
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

revoke execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text, text) from anon;
grant  execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text, text) to authenticated;


-- ── 5) Give a voucher use back when its order dies ───────────
-- rpc_checkout counts a use at order time, and nothing ever gave it back:
-- a customer whose order the restaurant rejected (or who cancelled) had
-- burned the use, and a limited code ran out on orders that never
-- happened. One trigger covers every cancel/reject path (customer, owner,
-- admin, future RPCs). If an order is brought back from cancelled, the
-- use is counted again.
create or replace function public.tg_orders_release_voucher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_dead boolean := old.status::text in ('cancelled', 'rejected');
  v_is_dead  boolean := new.status::text in ('cancelled', 'rejected');
begin
  if new.voucher_id is null or v_was_dead = v_is_dead then
    return new;
  end if;

  if v_is_dead then
    update vouchers set used_count = greatest(used_count - 1, 0)
    where id = new.voucher_id;
  else
    update vouchers set used_count = used_count + 1
    where id = new.voucher_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_release_voucher on public.orders;
create trigger trg_orders_release_voucher
  after update of status on public.orders
  for each row execute function public.tg_orders_release_voucher();


-- ── 6) rpc_validate_voucher — once per customer ──────────────
-- Same as 008 plus the per-customer rule, so the app says "you already
-- used this code" when the code is applied, not only at checkout. The
-- error strings are unchanged for the existing cases (the app maps them).
create or replace function public.rpc_validate_voucher(
  p_code          text,
  p_restaurant_id uuid,
  p_subtotal      numeric
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_v record;
  v_discount numeric;
  v_uid uuid := auth.uid();
begin
  select * into v_v from vouchers
  where code = p_code and restaurant_id = p_restaurant_id
    and is_active = true and valid_from <= now() and valid_to >= now();

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Invalid or expired voucher code');
  end if;

  if v_v.usage_limit is not null and v_v.used_count >= v_v.usage_limit then
    return jsonb_build_object('valid', false, 'error', 'Voucher usage limit reached');
  end if;

  if v_uid is not null and public.voucher_used_by(v_v.id, v_uid) then
    return jsonb_build_object('valid', false, 'error', 'voucher_already_used');
  end if;

  if p_subtotal < v_v.min_order_amount then
    return jsonb_build_object('valid', false,
      'error', format('Minimum order amount is %s', v_v.min_order_amount));
  end if;

  v_discount := case when v_v.discount_type = 'percentage'
    then (p_subtotal * v_v.discount_value) / 100
    else v_v.discount_value end;

  return jsonb_build_object(
    'valid', true, 'voucher_id', v_v.id, 'code', v_v.code,
    'discount', v_discount, 'discount_type', v_v.discount_type,
    'discount_value', v_v.discount_value
  );
end; $$;


-- ============================================================
-- Verification (run after applying; all should hold)
-- ============================================================
-- -- policies gone:
-- select tablename, policyname from pg_policies
-- where policyname in ('order_items: insert via rpc','user_notifications: insert allowed',
--                      'audit_logs: insert via rpc','favorites: public count visible');   -- 0 rows
--
-- -- lookup is service_role-only:
-- select has_function_privilege('authenticated', 'public.admin_auth_user_id_by_email(text)', 'execute'); -- false
-- select has_function_privilege('service_role',  'public.admin_auth_user_id_by_email(text)', 'execute'); -- true
--
-- -- triggers installed:
-- select tgname from pg_trigger
-- where tgname in ('trg_profiles_guard_privileged_columns','trg_orders_release_voucher');          -- 2 rows
--
-- -- vouchers whose count includes dead orders (one-off backfill, review before running):
-- select v.id, v.code, v.used_count,
--        count(o.id) filter (where o.status::text not in ('cancelled','rejected')) as live_uses
-- from vouchers v left join orders o on o.voucher_id = v.id
-- group by v.id having v.used_count <> count(o.id) filter (where o.status::text not in ('cancelled','rejected'));
