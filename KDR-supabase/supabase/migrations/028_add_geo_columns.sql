-- ============================================================
-- 028: Geo columns for distance-based delivery fee
--   - user_addresses: lat/lng + address_type + custom_label
--   - branches:       lat/lng (per-branch geo for distance calc)
--   - orders:         branch_id + delivery_address_id + snapshot
--                     of lat/lng/distance at order time
-- ============================================================

-- ── user_addresses ────────────────────────────────────────────
alter table public.user_addresses
  add column if not exists lat           double precision,
  add column if not exists lng           double precision,
  add column if not exists address_type  text not null default 'other'
    check (address_type in ('home','work','other')),
  add column if not exists custom_label  text;

-- ── branches ──────────────────────────────────────────────────
alter table public.branches
  add column if not exists lat double precision,
  add column if not exists lng double precision;

-- ── orders: branch + delivery snapshot ────────────────────────
alter table public.orders
  add column if not exists branch_id            uuid references public.branches(id)      on delete set null,
  add column if not exists delivery_address_id  uuid references public.user_addresses(id) on delete set null,
  add column if not exists branch_lat           double precision,
  add column if not exists branch_lng           double precision,
  add column if not exists delivery_lat         double precision,
  add column if not exists delivery_lng         double precision,
  add column if not exists delivery_distance_km numeric(6,2);

-- ── indexes ───────────────────────────────────────────────────
create index if not exists idx_branches_geo            on public.branches(lat, lng);
create index if not exists idx_user_addresses_geo      on public.user_addresses(lat, lng);
create index if not exists idx_orders_branch           on public.orders(branch_id);
create index if not exists idx_orders_delivery_addr    on public.orders(delivery_address_id);
