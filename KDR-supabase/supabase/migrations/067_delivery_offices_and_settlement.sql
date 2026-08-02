-- ============================================================
-- 067: Delivery offices, couriers, capacity and cash settlement.
--
-- Context
--   Until now a "driver" was just `profiles.role = 'driver'` with a hard
--   one-active-order rule baked into rpc_driver_claim_order. We now also
--   onboard delivery *offices*: one account that accepts many orders at
--   once and hands them out to its own riders, who do NOT get accounts.
--
--   The driver flow has never been switched on in production (1 driver
--   profile, 7 test orders), so this migration is free to reshape it
--   properly instead of bolting the office case onto the side.
--
-- Model
--   • profiles            — identity/auth, unchanged. `is_available`
--                           stays here because the deployed `send-push`
--                           edge function targets drivers through it.
--   • delivery_providers  — 1:1 with a driver profile. Says whether this
--                           account is an individual rider or an office,
--                           and how many orders it may hold at once.
--   • office_couriers     — an office's riders. Rows, not accounts.
--   • orders.courier_id   — which rider an office handed the order to.
--                           `driver_id` still points at the *account*
--                           that is responsible, so every existing
--                           earnings/report query keeps working untouched.
--
-- Cash
--   Money flows rider → restaurant → customer → rider:
--   the rider pays the restaurant for the food at pickup and collects the
--   full order value from the customer, keeping the delivery fee.
--   Per order that means
--       restaurant_payout = subtotal - discount   (handed over the counter)
--       customer_pays     = total_amount          (= payout + delivery_fee)
--       provider_earns    = delivery_fee
--   All three are derivable from columns we already store, so nothing is
--   duplicated. Only facts we cannot recompute get persisted:
--   who collected, how much they actually collected when it differed, and
--   whether that cash has been handed in (`provider_settlements`).
--
--   Note `subtotal - discount` is identically `restaurant_revenue +
--   commission_amount` — the platform invoices its commission to the
--   restaurant separately, and the voucher absorption from migration 053
--   already nets out correctly at the counter.
-- ============================================================

-- ── 1. Delivery providers ────────────────────────────────────
create table if not exists public.delivery_providers (
  id                    uuid primary key references public.profiles(id) on delete cascade,
  kind                  text not null default 'individual'
                          check (kind in ('individual','office')),
  -- Office trade name. Individuals fall back to profiles.full_name.
  display_name          text,
  max_concurrent_orders integer not null default 1
                          check (max_concurrent_orders between 1 and 50),
  -- Admin kill-switch: suspends claiming without deleting the account.
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- An individual rider is one-order-at-a-time by definition; letting an
  -- individual carry a capacity > 1 would silently reintroduce the very
  -- behaviour the single-order rule exists to prevent.
  constraint delivery_providers_individual_capacity
    check (kind = 'office' or max_concurrent_orders = 1)
);

comment on table public.delivery_providers is
  'Per-account delivery settings. One row per profiles.role = ''driver''.';

-- Every existing driver account is an individual rider.
insert into public.delivery_providers (id, kind, display_name)
select p.id, 'individual', p.full_name
from public.profiles p
where p.role = 'driver'
on conflict (id) do nothing;

-- ── 2. Office couriers ───────────────────────────────────────
-- Deliberately NOT linked to auth: an office's riders are managed by the
-- office, have no login, and never see the app.
create table if not exists public.office_couriers (
  id         uuid primary key default gen_random_uuid(),
  office_id  uuid not null references public.delivery_providers(id) on delete cascade,
  full_name  text not null check (length(btrim(full_name)) > 0),
  phone      text not null check (length(btrim(phone)) > 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phone is how the office WhatsApps an order to the rider, so a
  -- duplicate inside one office is always a data-entry mistake.
  constraint office_couriers_phone_unique unique (office_id, phone)
);

comment on table public.office_couriers is
  'An office''s riders. Rows, not accounts — they never log in.';

create index if not exists idx_office_couriers_office
  on public.office_couriers(office_id) where is_active;

-- ── 3. Settlements ───────────────────────────────────────────
-- A cash handover. For an office it records a rider walking in and paying
-- what they collected; for an individual it is their own day close.
create table if not exists public.provider_settlements (
  id                    uuid primary key default gen_random_uuid(),
  provider_id           uuid not null references public.delivery_providers(id) on delete cascade,
  -- null = the provider settling for itself (individual rider's day book).
  courier_id            uuid references public.office_couriers(id) on delete set null,
  orders_count          integer not null default 0,
  -- Σ over the settled orders, snapshotted so later order edits or
  -- refunds can never rewrite a settlement that already happened.
  total_collected       numeric(12,2) not null default 0,
  total_restaurant_paid numeric(12,2) not null default 0,
  total_delivery_fees   numeric(12,2) not null default 0,
  -- What the books say should change hands vs what actually did. They
  -- differ when a rider is short, rounds, or holds something back — and
  -- pretending that never happens is how a ledger stops being trusted.
  expected_amount       numeric(12,2) not null default 0,
  received_amount       numeric(12,2) not null default 0,
  difference            numeric(12,2) generated always as (received_amount - expected_amount) stored,
  note                  text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);

comment on table public.provider_settlements is
  'Cash handovers: what a rider owed vs what they actually paid in.';

create index if not exists idx_provider_settlements_provider
  on public.provider_settlements(provider_id, created_at desc);

-- ── 4. Order columns ─────────────────────────────────────────
alter table public.orders
  -- Which of the office's riders physically took this order.
  add column if not exists courier_id      uuid references public.office_couriers(id) on delete set null,
  add column if not exists assigned_at     timestamptz,
  -- Only set when the cash taken differs from total_amount; null means
  -- "collected exactly what was owed" so we don't store 99% redundant rows.
  add column if not exists collected_amount numeric(10,2),
  add column if not exists settlement_id   uuid references public.provider_settlements(id) on delete set null,
  add column if not exists settled_at      timestamptz;

create index if not exists idx_orders_courier
  on public.orders(courier_id) where courier_id is not null;

-- Unsettled-cash lookups drive the settlement screen and must stay cheap
-- as delivered orders pile up.
create index if not exists idx_orders_unsettled
  on public.orders(driver_id, delivered_at)
  where settlement_id is null and status = 'delivered';

-- ── 5. Helpers ───────────────────────────────────────────────

-- Every driver account needs a provider row or it can list the pool but
-- not claim from it. A trigger is the only way to guarantee that for
-- accounts created later (admin promoting a user, OTP signup flow).
create or replace function public.ensure_delivery_provider()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'driver' then
    insert into public.delivery_providers (id, kind, display_name)
    values (new.id, 'individual', new.full_name)
    on conflict (id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists trg_ensure_delivery_provider on public.profiles;
create trigger trg_ensure_delivery_provider
  after insert or update of role on public.profiles
  for each row execute function public.ensure_delivery_provider();

-- How many more orders this account may hold right now. Negative is
-- impossible by construction but clamped anyway.
create or replace function public.provider_spare_capacity(p_provider_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce((select max_concurrent_orders from delivery_providers where id = p_provider_id), 1)
    - (select count(*) from orders
       where driver_id = p_provider_id
         and status in ('preparing','ready_for_pickup','out_for_delivery')),
    0
  )::integer;
$$;

-- ── 6. Claiming, releasing, capacity ─────────────────────────

-- Replaces the hard "one active order" rule with the provider's capacity,
-- and starts actually honouring `is_available` — until now a driver could
-- toggle themselves offline and still claim, because nothing read the flag.
create or replace function public.rpc_driver_claim_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_provider  delivery_providers;
  v_available boolean;
  v_claimed   uuid;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select * into v_provider from delivery_providers where id = v_uid;
  if not found then
    return jsonb_build_object('error', 'no_provider_profile');
  end if;
  if not v_provider.is_active then
    return jsonb_build_object('error', 'provider_suspended');
  end if;

  select coalesce(is_available, false) into v_available from profiles where id = v_uid;
  if not v_available then
    return jsonb_build_object('error', 'not_available');
  end if;

  if public.provider_spare_capacity(v_uid) <= 0 then
    -- 'has_active_order' is kept verbatim for individuals so the existing
    -- driver app copy ("أنهِ طلبك الحالي أولاً") stays accurate.
    return jsonb_build_object(
      'error', case when v_provider.kind = 'office' then 'capacity_full' else 'has_active_order' end,
      'max_concurrent_orders', v_provider.max_concurrent_orders
    );
  end if;

  update orders set
    driver_id  = v_uid,
    claimed_at = now(),
    updated_at = now()
  where id = p_order_id
    and driver_id is null
    and order_type = 'delivery'
    and delivery_by_owner = false
    and status in ('preparing', 'ready_for_pickup')
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('error', 'already_claimed');
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('driver_id', v_uid, 'action', 'claim'));

  perform realtime.send(
    jsonb_build_object('order_id', p_order_id, 'claimed_by', v_uid),
    'order_claimed',
    'delivery_pool',
    true
  );

  return public.driver_order_json(p_order_id);
end; $$;

revoke execute on function public.rpc_driver_claim_order(uuid) from anon, public;

-- NEW. There was previously no way to give a claimed order back: a rider
-- whose bike broke sat on the order forever, blocked from claiming
-- anything else by the one-order rule, and the customer's order was
-- stranded until someone edited the database by hand.
--
-- Only allowed before pickup. Once the food is collected the order is
-- physically in the rider's hands and abandoning it is an admin matter,
-- not a self-service button.
create or replace function public.rpc_driver_release_order(
  p_order_id uuid,
  p_reason   text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_order    record;
  v_released uuid;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select * into v_order from orders where id = p_order_id and driver_id = v_uid;
  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  if v_order.status not in ('preparing', 'ready_for_pickup') then
    return jsonb_build_object('error', 'too_late_to_release');
  end if;

  update orders set
    driver_id   = null,
    courier_id  = null,
    claimed_at  = null,
    assigned_at = null,
    updated_at  = now()
  where id = p_order_id
    and driver_id = v_uid
    and status in ('preparing', 'ready_for_pickup')
  returning id into v_released;

  if v_released is null then
    return jsonb_build_object('error', 'release_failed');
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('action', 'release', 'reason', p_reason));

  -- Put it back in front of everyone else immediately; a released order
  -- that only reappears on the next poll is a cold meal.
  perform realtime.send(
    jsonb_build_object('order_id', p_order_id, 'released_by', v_uid),
    'order_released',
    'delivery_pool',
    true
  );

  return jsonb_build_object('released', true, 'order_id', p_order_id);
end; $$;

revoke execute on function public.rpc_driver_release_order(uuid, text) from anon, public;

-- Capacity-aware pool listing. Offices keep seeing the pool while they
-- still have room, instead of the list going blank on the first claim.
create or replace function public.rpc_driver_get_available_orders(
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid    := auth.uid();
  v_offset    integer := (p_page - 1) * p_page_size;
  v_total     integer;
  v_data      jsonb;
  v_spare     integer;
  v_provider  delivery_providers;
  v_available boolean;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select * into v_provider from delivery_providers where id = v_uid;
  select coalesce(is_available, false) into v_available from profiles where id = v_uid;
  v_spare := public.provider_spare_capacity(v_uid);

  if v_spare <= 0 or not v_available or not coalesce(v_provider.is_active, true) then
    return jsonb_build_object(
      'data', '[]'::jsonb,
      'meta', jsonb_build_object(
        'total', 0, 'page', p_page,
        'page_size', p_page_size, 'total_pages', 0,
        -- Legacy key the shipped driver app reads. For an individual this
        -- is exactly what it always meant.
        'has_active_order', v_spare <= 0,
        'spare_capacity', v_spare,
        'max_concurrent_orders', coalesce(v_provider.max_concurrent_orders, 1),
        'is_available', v_available,
        'provider_kind', coalesce(v_provider.kind, 'individual')
      )
    );
  end if;

  select count(*) into v_total from orders
  where driver_id is null
    and order_type = 'delivery'
    and delivery_by_owner = false
    and status in ('preparing', 'ready_for_pickup');

  select coalesce(jsonb_agg(public.driver_order_json(o.id) order by o.created_at desc), '[]'::jsonb)
  into v_data
  from (
    select id, created_at from orders
    where driver_id is null
      and order_type = 'delivery'
      and delivery_by_owner = false
      and status in ('preparing', 'ready_for_pickup')
    order by created_at desc
    limit p_page_size offset v_offset
  ) o;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object(
      'total', v_total, 'page', p_page,
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size),
      'has_active_order', false,
      'spare_capacity', v_spare,
      'max_concurrent_orders', coalesce(v_provider.max_concurrent_orders, 1),
      'is_available', v_available,
      'provider_kind', coalesce(v_provider.kind, 'individual')
    )
  );
end; $$;

revoke execute on function public.rpc_driver_get_available_orders(integer, integer) from anon, public;

-- Going offline while holding orders used to be allowed, which quietly
-- stopped new-order pushes for a rider the system still considered
-- responsible for live deliveries.
create or replace function public.rpc_driver_set_availability(p_is_available boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_active integer;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  if p_is_available = false then
    select count(*) into v_active from orders
    where driver_id = v_uid
      and status in ('preparing','ready_for_pickup','out_for_delivery');
    if v_active > 0 then
      return jsonb_build_object('error', 'has_active_orders', 'active_orders', v_active);
    end if;
  end if;

  update public.profiles
     set is_available = p_is_available,
         updated_at   = now()
   where id = v_uid;

  return jsonb_build_object('is_available', p_is_available);
end; $$;

revoke execute on function public.rpc_driver_set_availability(boolean) from anon, public;

-- ── 7. Office: courier roster ────────────────────────────────

create or replace function public.rpc_office_list_couriers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(
    select 1 from delivery_providers where id = v_uid and kind = 'office'
  ) then
    return jsonb_build_object('error', 'not_an_office');
  end if;

  return jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',        c.id,
      'full_name', c.full_name,
      'phone',     c.phone,
      'is_active', c.is_active,
      -- Live workload, so the dispatcher assigns to whoever is free
      -- rather than piling everything on the first name in the list.
      'active_orders', (
        select count(*) from orders o
        where o.courier_id = c.id
          and o.status in ('preparing','ready_for_pickup','out_for_delivery')
      ),
      'unsettled_amount', (
        select coalesce(sum(coalesce(o.collected_amount, o.total_amount) - (o.subtotal - o.discount)), 0)
        from orders o
        where o.courier_id = c.id
          and o.status = 'delivered'
          and o.settlement_id is null
      )
    ) order by c.is_active desc, c.full_name)
    from office_couriers c where c.office_id = v_uid
  ), '[]'::jsonb));
end; $$;

revoke execute on function public.rpc_office_list_couriers() from anon, public;

create or replace function public.rpc_office_upsert_courier(
  p_courier_id uuid    default null,
  p_full_name  text    default null,
  p_phone      text    default null,
  p_is_active  boolean default true
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null or not exists(
    select 1 from delivery_providers where id = v_uid and kind = 'office'
  ) then
    return jsonb_build_object('error', 'not_an_office');
  end if;

  if coalesce(btrim(p_full_name), '') = '' or coalesce(btrim(p_phone), '') = '' then
    return jsonb_build_object('error', 'name_and_phone_required');
  end if;

  if p_courier_id is null then
    insert into office_couriers (office_id, full_name, phone, is_active)
    values (v_uid, btrim(p_full_name), btrim(p_phone), p_is_active)
    returning id into v_id;
  else
    update office_couriers set
      full_name  = btrim(p_full_name),
      phone      = btrim(p_phone),
      is_active  = p_is_active,
      updated_at = now()
    where id = p_courier_id and office_id = v_uid
    returning id into v_id;

    if v_id is null then
      return jsonb_build_object('error', 'courier_not_found');
    end if;
  end if;

  return jsonb_build_object('id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('error', 'phone_already_used');
end; $$;

revoke execute on function public.rpc_office_upsert_courier(uuid, text, text, boolean) from anon, public;

-- Deactivate rather than delete: couriers are referenced by delivered
-- orders and settlements, and erasing one would blank out history.
create or replace function public.rpc_office_deactivate_courier(p_courier_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_active   integer;
  v_unsettled numeric;
begin
  if v_uid is null or not exists(
    select 1 from delivery_providers where id = v_uid and kind = 'office'
  ) then
    return jsonb_build_object('error', 'not_an_office');
  end if;

  select count(*) into v_active from orders
  where courier_id = p_courier_id
    and status in ('preparing','ready_for_pickup','out_for_delivery');
  if v_active > 0 then
    return jsonb_build_object('error', 'courier_has_active_orders', 'active_orders', v_active);
  end if;

  select coalesce(sum(coalesce(o.collected_amount, o.total_amount) - (o.subtotal - o.discount)), 0)
  into v_unsettled
  from orders o
  where o.courier_id = p_courier_id and o.status = 'delivered' and o.settlement_id is null;
  if v_unsettled > 0 then
    return jsonb_build_object('error', 'courier_has_unsettled_cash', 'amount', v_unsettled);
  end if;

  update office_couriers set is_active = false, updated_at = now()
  where id = p_courier_id and office_id = v_uid;

  if not found then
    return jsonb_build_object('error', 'courier_not_found');
  end if;
  return jsonb_build_object('deactivated', true);
end; $$;

revoke execute on function public.rpc_office_deactivate_courier(uuid) from anon, public;

-- ── 8. Office: assigning an order to a courier ───────────────
create or replace function public.rpc_office_assign_courier(
  p_order_id   uuid,
  p_courier_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(
    select 1 from delivery_providers where id = v_uid and kind = 'office'
  ) then
    return jsonb_build_object('error', 'not_an_office');
  end if;

  -- Unassigning is a normal correction (wrong rider tapped), so a null
  -- courier is allowed and simply clears the assignment.
  if p_courier_id is not null and not exists(
    select 1 from office_couriers
    where id = p_courier_id and office_id = v_uid and is_active
  ) then
    return jsonb_build_object('error', 'courier_not_found');
  end if;

  update orders set
    courier_id  = p_courier_id,
    assigned_at = case when p_courier_id is null then null else now() end,
    updated_at  = now()
  where id = p_order_id
    and driver_id = v_uid
    and status in ('preparing','ready_for_pickup','out_for_delivery');

  if not found then
    return jsonb_build_object('error', 'order_not_found');
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('action', 'assign_courier', 'courier_id', p_courier_id));

  return public.driver_order_json(p_order_id);
end; $$;

revoke execute on function public.rpc_office_assign_courier(uuid, uuid) from anon, public;

-- ── 9. Settlement ────────────────────────────────────────────

-- Everything still owed, optionally narrowed to one courier. Drives both
-- the office's "استلام من الطيار" screen and the individual's day book.
create or replace function public.rpc_provider_get_unsettled(p_courier_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  return jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'orders_count',          count(*),
        'total_collected',       coalesce(sum(coalesce(o.collected_amount, o.total_amount)), 0),
        'total_restaurant_paid', coalesce(sum(o.subtotal - o.discount), 0),
        'total_delivery_fees',   coalesce(sum(o.delivery_fee), 0),
        -- What the rider should be holding: everything taken from
        -- customers minus everything already paid out over the counter.
        'expected_amount',       coalesce(sum(coalesce(o.collected_amount, o.total_amount) - (o.subtotal - o.discount)), 0)
      )
      from orders o
      where o.driver_id = v_uid
        and o.status = 'delivered'
        and o.settlement_id is null
        and (p_courier_id is null or o.courier_id = p_courier_id)
    ),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                o.id,
        'delivered_at',      o.delivered_at,
        'restaurant_payout', o.subtotal - o.discount,
        'collected',         coalesce(o.collected_amount, o.total_amount),
        'delivery_fee',      o.delivery_fee,
        'courier_id',        o.courier_id
      ) order by o.delivered_at desc)
      from orders o
      where o.driver_id = v_uid
        and o.status = 'delivered'
        and o.settlement_id is null
        and (p_courier_id is null or o.courier_id = p_courier_id)
    ), '[]'::jsonb)
  );
end; $$;

revoke execute on function public.rpc_provider_get_unsettled(uuid) from anon, public;

-- Records that the rider took something other than the full order value —
-- customer short on cash, a rounded note, a partial refund at the door.
-- Kept separate from rpc_driver_update_order_status on purpose: adding a
-- defaulted third argument there would create a second overload of the
-- same name, which is exactly the PGRST203 ambiguity that broke checkout
-- in migration 055.
create or replace function public.rpc_provider_record_collection(
  p_order_id uuid,
  p_amount   numeric
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_order record;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;
  if p_amount is null or p_amount < 0 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;

  select * into v_order from orders where id = p_order_id and driver_id = v_uid;
  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  -- Once the cash is in a settlement the books are closed; a correction
  -- after that is an admin adjustment, not a driver edit.
  if v_order.settlement_id is not null then
    return jsonb_build_object('error', 'already_settled');
  end if;

  update orders set
    -- Store null when it matches the expected total so "was there an
    -- exception on this order?" stays a simple non-null check.
    collected_amount = case when p_amount = v_order.total_amount then null else p_amount end,
    updated_at       = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('action', 'record_collection', 'amount', p_amount));

  return jsonb_build_object('order_id', p_order_id, 'collected', p_amount);
end; $$;

revoke execute on function public.rpc_provider_record_collection(uuid, numeric) from anon, public;

-- Records what the rider actually handed over and stamps the orders it
-- covers. Snapshotting the totals means a later correction to an order
-- can never silently rewrite a settlement that already happened.
create or replace function public.rpc_provider_settle(
  p_courier_id      uuid    default null,
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

  -- Pin the exact set of orders first and lock them. Summing and then
  -- updating by predicate would let an order delivered in between get
  -- stamped with this settlement without being counted in its totals —
  -- money that silently disappears from the next settlement too.
  -- FOR UPDATE has to sit in a subquery: Postgres rejects it alongside an
  -- aggregate in the same select list.
  with locked as (
    select o.id
    from orders o
    where o.driver_id = v_uid
      and o.status = 'delivered'
      and o.settlement_id is null
      and (p_courier_id is null or o.courier_id = p_courier_id)
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
    provider_id, courier_id, orders_count,
    total_collected, total_restaurant_paid, total_delivery_fees,
    expected_amount, received_amount, note, created_by
  ) values (
    v_uid, p_courier_id, v_sum.orders_count,
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
    jsonb_build_object('courier_id', p_courier_id, 'orders', v_sum.orders_count));

  return jsonb_build_object(
    'id',              v_id,
    'orders_count',    v_sum.orders_count,
    'expected_amount', v_sum.expected,
    'received_amount', coalesce(p_received_amount, v_sum.expected)
  );
end; $$;

revoke execute on function public.rpc_provider_settle(uuid, numeric, text) from anon, public;

-- ── 10. RLS ──────────────────────────────────────────────────
alter table public.delivery_providers  enable row level security;
alter table public.office_couriers     enable row level security;
alter table public.provider_settlements enable row level security;

-- Providers read their own row; only admins may change kind or capacity,
-- otherwise an office could raise its own limit.
drop policy if exists "delivery_providers: read own" on public.delivery_providers;
create policy "delivery_providers: read own" on public.delivery_providers
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "delivery_providers: admin writes" on public.delivery_providers;
create policy "delivery_providers: admin writes" on public.delivery_providers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "office_couriers: office manages own" on public.office_couriers;
create policy "office_couriers: office manages own" on public.office_couriers
  for all using (office_id = auth.uid() or public.is_admin())
  with check (office_id = auth.uid() or public.is_admin());

drop policy if exists "provider_settlements: own" on public.provider_settlements;
create policy "provider_settlements: own" on public.provider_settlements
  for select using (provider_id = auth.uid() or public.is_admin());

drop policy if exists "provider_settlements: admin writes" on public.provider_settlements;
create policy "provider_settlements: admin writes" on public.provider_settlements
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.delivery_providers   to authenticated;
grant select on public.office_couriers      to authenticated;
grant select on public.provider_settlements to authenticated;

-- ── 11. Driver order JSON: courier + cash ────────────────────
create or replace function public.driver_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                o.id,
    'status',            o.status,
    'order_type',        o.order_type,
    'delivery_by_owner', o.delivery_by_owner,
    'total_amount',      o.total_amount,
    'subtotal',          o.subtotal,
    'delivery_fee',      o.delivery_fee,
    'discount',          o.discount,
    'delivery_address',  o.delivery_address,
    'delivery_lat',      o.delivery_lat,
    'delivery_lng',      o.delivery_lng,
    'contact_phone',     o.contact_phone,
    'alternate_phone',   o.alternate_phone,
    'notes',             o.notes,
    'accepted_at',       o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'claimed_at',        o.claimed_at,
    'picked_up_at',      o.picked_up_at,
    'delivered_at',      o.delivered_at,
    'created_at',        o.created_at,
    'updated_at',        o.updated_at,
    'driver_id',         o.driver_id,
    'assigned_at',       o.assigned_at,
    'settled_at',        o.settled_at,
    'cash',              jsonb_build_object(
                           'restaurant_payout', o.subtotal - o.discount,
                           'customer_pays',     o.total_amount,
                           'provider_earns',    o.delivery_fee,
                           'collected',         coalesce(o.collected_amount, o.total_amount),
                           'is_settled',        o.settlement_id is not null
                         ),
    'courier', case when c.id is null then null else jsonb_build_object(
                           'id',        c.id,
                           'full_name', c.full_name,
                           'phone',     c.phone
                         ) end,
    'items_count',       (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',          jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
    'restaurant',        jsonb_build_object(
                           'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
                           'logo_url', r.logo_url),
    'branch', case when b.id is null then null else jsonb_build_object(
                           'id',            b.id,
                           'name_ar',       b.name_ar,
                           'name_en',       b.name_en,
                           'address_ar',    b.address_ar,
                           'address_en',    b.address_en,
                           'location_url',  b.location_url,
                           'lat',           coalesce(o.branch_lat, b.lat),
                           'lng',           coalesce(o.branch_lng, b.lng),
                           'phone',         coalesce((
                             select bp.phone from branch_phones bp
                             where bp.branch_id = b.id
                             order by bp.id limit 1
                           ), '')
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
  from orders o
  left join profiles        p on p.id = o.user_id
  join      restaurants     r on r.id = o.restaurant_id
  left join branches        b on b.id = o.branch_id
  left join office_couriers c on c.id = o.courier_id
  where o.id = p_order_id;
$$;

revoke execute on function public.driver_order_json(uuid) from anon, public;

-- ── 12. Admin: manage providers ──────────────────────────────
create or replace function public.rpc_admin_upsert_delivery_provider(
  p_profile_id            uuid,
  p_kind                  text default 'individual',
  p_display_name          text default null,
  p_max_concurrent_orders integer default null,
  p_is_active             boolean default true
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_max integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Not an admin');
  end if;
  if p_kind not in ('individual','office') then
    return jsonb_build_object('error', 'invalid_kind');
  end if;
  if not exists(select 1 from profiles where id = p_profile_id and role = 'driver') then
    return jsonb_build_object('error', 'profile_is_not_a_driver');
  end if;

  -- Individuals are pinned to 1 by the table constraint; defaulting an
  -- office to 10 keeps the admin form from having to think about it.
  v_max := case
             when p_kind = 'individual' then 1
             else coalesce(p_max_concurrent_orders, 10)
           end;

  insert into delivery_providers (id, kind, display_name, max_concurrent_orders, is_active)
  values (p_profile_id, p_kind, p_display_name, v_max, p_is_active)
  on conflict (id) do update set
    kind                  = excluded.kind,
    display_name          = excluded.display_name,
    max_concurrent_orders = excluded.max_concurrent_orders,
    is_active             = excluded.is_active,
    updated_at            = now();

  return jsonb_build_object('id', p_profile_id, 'kind', p_kind, 'max_concurrent_orders', v_max);
end; $$;

revoke execute on function public.rpc_admin_upsert_delivery_provider(uuid, text, text, integer, boolean) from anon, public;
