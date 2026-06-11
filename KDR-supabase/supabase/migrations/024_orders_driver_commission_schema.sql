-- ============================================================
-- 024: Orders schema — order types, prep time, driver, commission
-- ============================================================

-- ── orders: new lifecycle / driver / commission columns ───────
alter table public.orders
  add column if not exists order_type                    public.order_type not null default 'delivery',
  add column if not exists accepted_at                   timestamptz,
  add column if not exists estimated_preparation_minutes integer,
  add column if not exists rejection_reason              text,
  add column if not exists driver_id                     uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_at                    timestamptz,
  add column if not exists picked_up_at                  timestamptz,
  add column if not exists delivered_at                  timestamptz,
  add column if not exists commission_percentage         numeric(5,2)  not null default 0,
  add column if not exists commission_amount             numeric(10,2) not null default 0,
  add column if not exists restaurant_revenue            numeric(10,2) not null default 0;

-- Pickup orders have no delivery address
alter table public.orders alter column delivery_address drop not null;

-- ── restaurants: platform commission, set by admin ────────────
alter table public.restaurants
  add column if not exists commission_percentage numeric(5,2) not null default 0
  check (commission_percentage >= 0 and commission_percentage <= 100);

-- ── indexes ────────────────────────────────────────────────────
create index if not exists idx_orders_driver on public.orders(driver_id);

-- Partial index for the driver "available orders" feed
create index if not exists idx_orders_claimable
  on public.orders(created_at)
  where driver_id is null and order_type = 'delivery';

-- ── helper: is_driver() (mirrors is_admin / is_restaurant_owner)
create or replace function public.is_driver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt()->>'user_role', '') = 'driver',
    exists(select 1 from public.profiles where id = auth.uid() and role = 'driver')
  );
$$;

revoke execute on function public.is_driver() from anon, public;

-- ── helper: notify_order_event ─────────────────────────────────
-- Shared fire-and-forget pg_net POST to the send-push edge
-- function (pattern extracted from 020).
create or replace function public.notify_order_event(p_event text, p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_supa_url text;
  v_supa_key text;
begin
  select value into v_supa_url from app_config where key = 'supabase_url';
  select value into v_supa_key from app_config where key = 'supabase_service_key';

  if v_supa_url is null or v_supa_key is null then
    return;
  end if;

  begin
    perform net.http_post(
      url     := v_supa_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_supa_key
      ),
      body    := jsonb_build_object('event', p_event, 'order_id', p_order_id)
    );
  exception when others then null;
  end;
end; $$;

revoke execute on function public.notify_order_event(text, uuid) from anon, public;

-- ── RLS: drivers ───────────────────────────────────────────────
-- Drivers see their own claimed orders plus the unclaimed
-- delivery pool. Needed for realtime postgres_changes too.
drop policy if exists "orders: driver reads pool and own" on public.orders;
create policy "orders: driver reads pool and own"
  on public.orders for select
  using (
    public.is_driver()
    and (
      driver_id = auth.uid()
      or (driver_id is null
          and order_type = 'delivery'
          and status in ('preparing', 'ready_for_pickup'))
    )
  );

drop policy if exists "order_items: driver reads claimed" on public.order_items;
create policy "order_items: driver reads claimed"
  on public.order_items for select
  using (
    public.is_driver()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.driver_id = auth.uid()
    )
  );
