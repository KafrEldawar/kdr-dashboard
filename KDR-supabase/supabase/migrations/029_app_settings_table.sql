-- ============================================================
-- 029: app_settings — jsonb key/value config readable by all
--       authed users, writable only by admins.
--
-- Distinct from app_config (text, admin-only secrets like
-- supabase_url / service_role_key).
--
-- Used for: delivery_fee_config and any future runtime knobs.
-- ============================================================

create table if not exists public.app_settings (
  key         text         primary key,
  value       jsonb        not null,
  updated_at  timestamptz  not null default now(),
  updated_by  uuid         references public.profiles(id) on delete set null
);

alter table public.app_settings enable row level security;

-- Authenticated users can read any setting (the client needs to
-- show the delivery fee config in the cart UI).
drop policy if exists "app_settings: authed read" on public.app_settings;
create policy "app_settings: authed read"
  on public.app_settings for select
  to authenticated
  using (true);

-- Only admins can insert / update / delete.
drop policy if exists "app_settings: admin write" on public.app_settings;
create policy "app_settings: admin write"
  on public.app_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- updated_at trigger (reuse the shared helper)
drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

grant select on public.app_settings to authenticated;

-- ── Seed: delivery_fee_config ─────────────────────────────────
-- Tweakable by admins via the dashboard /settings/delivery page.
-- The compute_delivery_fee RPC (migration 030) reads from here.
insert into public.app_settings (key, value)
values (
  'delivery_fee_config',
  jsonb_build_object(
    'base',            10,
    'per_km',          3,
    'min',             10,
    'max',             60,
    'route_factor',    1.3,
    'max_distance_km', 15,
    'currency',        'EGP'
  )
)
on conflict (key) do nothing;
