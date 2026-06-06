-- ============================================================
-- 002: All Tables
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
-- Extends auth.users. Created automatically via trigger.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        public.user_role        not null default 'customer',
  full_name   text,
  phone       text,
  gender      public.gender_type,
  avatar_url  text,
  is_active   boolean                 not null default true,
  created_at  timestamptz             not null default now(),
  updated_at  timestamptz             not null default now()
);

-- ── categories ───────────────────────────────────────────────
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text    not null,
  name_en     text    not null,
  image_url   text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── restaurants ───────────────────────────────────────────────
create table public.restaurants (
  id                        uuid primary key default gen_random_uuid(),
  name_ar                   text           not null,
  name_en                   text           not null,
  logo_url                  text,
  cover_url                 text,
  description_ar            text,
  description_en            text,
  accepts_online_orders     boolean        not null default true,
  is_accepting_orders       boolean        not null default true,
  estimated_delivery_time   integer        not null default 30,   -- minutes
  delivery_fee              numeric(6,2)   not null default 15.00,
  min_order_amount          numeric(10,2)  not null default 0,
  is_active                 boolean        not null default true,
  created_at                timestamptz    not null default now(),
  updated_at                timestamptz    not null default now()
);

-- ── restaurant_categories (M2M) ───────────────────────────────
create table public.restaurant_categories (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id   uuid not null references public.categories(id)  on delete cascade,
  primary key (restaurant_id, category_id)
);

-- ── restaurant_owners ─────────────────────────────────────────
-- One user → one restaurant. DB-enforced one-to-one.
create table public.restaurant_owners (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id)     on delete cascade,
  restaurant_id uuid not null references public.restaurants(id)  on delete cascade,
  created_at    timestamptz not null default now(),
  constraint unique_owner_user       unique (user_id),
  constraint unique_owner_restaurant unique (restaurant_id)
);

-- ── branches ──────────────────────────────────────────────────
create table public.branches (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name_ar       text,
  name_en       text,
  address_ar    text not null,
  address_en    text not null,
  location_url  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── branch_phones ─────────────────────────────────────────────
create table public.branch_phones (
  id        uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  phone     text not null
);

-- ── menu_items ────────────────────────────────────────────────
create table public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id   uuid          references public.categories(id)  on delete set null,
  name_ar       text           not null,
  name_en       text           not null,
  price         numeric(10,2)  not null,
  description_ar text,
  description_en text,
  image_url     text,
  is_available  boolean        not null default true,
  sort_order    integer        not null default 0,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now()
);

-- ── restaurant_gallery ────────────────────────────────────────
create table public.restaurant_gallery (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  image_url     text not null,
  description   text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

-- ── offers ────────────────────────────────────────────────────
create table public.offers (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid          not null references public.restaurants(id) on delete cascade,
  title_ar            text          not null,
  title_en            text,
  description_ar      text,
  description_en      text,
  image_url           text,
  discount_percentage numeric(5,2)  not null,
  is_active           boolean       not null default true,
  start_date          date,
  end_date            date,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

-- ── vouchers ──────────────────────────────────────────────────
create table public.vouchers (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid          not null references public.restaurants(id) on delete cascade,
  code              text          not null,
  discount_type     public.discount_type_enum not null default 'percentage',
  discount_value    numeric(10,2) not null,
  min_order_amount  numeric(10,2) not null default 0,
  valid_from        timestamptz   not null default now(),
  valid_to          timestamptz   not null,
  is_active         boolean       not null default true,
  usage_limit       integer,      -- null = unlimited
  used_count        integer       not null default 0,
  created_at        timestamptz   not null default now(),
  constraint unique_voucher_code unique (restaurant_id, code)
);

-- ── carts ─────────────────────────────────────────────────────
-- One cart per user (auto-created on first add-to-cart)
create table public.carts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint unique_user_cart unique (user_id)
);

-- ── cart_items ────────────────────────────────────────────────
create table public.cart_items (
  id                    uuid primary key default gen_random_uuid(),
  cart_id               uuid    not null references public.carts(id)      on delete cascade,
  menu_item_id          uuid    not null references public.menu_items(id) on delete cascade,
  quantity              integer not null default 1 check (quantity > 0),
  special_instructions  text,
  created_at            timestamptz not null default now()
);

-- ── orders ────────────────────────────────────────────────────
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid           not null references public.profiles(id)     on delete restrict,
  restaurant_id       uuid           not null references public.restaurants(id)  on delete restrict,
  status              public.order_status not null default 'pending',
  delivery_address    text           not null,
  contact_phone       text           not null,
  subtotal            numeric(10,2)  not null default 0,
  delivery_fee        numeric(6,2)   not null default 0,
  discount            numeric(10,2)  not null default 0,
  total_amount        numeric(10,2)  not null default 0,
  voucher_id          uuid           references public.vouchers(id) on delete set null,
  notes               text,
  restaurant_rating   integer        check (restaurant_rating between 1 and 5),
  restaurant_review   text,
  rated_at            timestamptz,
  created_at          timestamptz    not null default now(),
  updated_at          timestamptz    not null default now()
);

-- ── order_items ───────────────────────────────────────────────
-- Price and names are snapshots — never change after checkout.
create table public.order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid          not null references public.orders(id) on delete cascade,
  menu_item_id          uuid          references public.menu_items(id) on delete set null,
  item_name_en          text          not null,
  item_name_ar          text          not null,
  price                 numeric(10,2) not null,
  quantity              integer       not null default 1,
  special_instructions  text
);

-- ── device_tokens ─────────────────────────────────────────────
create table public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  token        text not null unique,
  platform     public.device_platform not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

-- ── notification_campaigns ────────────────────────────────────
create table public.notification_campaigns (
  id             uuid primary key default gen_random_uuid(),
  title_ar       text           not null,
  title_en       text,
  body_ar        text           not null,
  body_en        text,
  image_url      text,
  extra_data     jsonb          not null default '{}',
  target_type    public.notification_target not null,
  target_filter  jsonb          not null default '{}',
  sent_count     integer        not null default 0,
  failed_count   integer        not null default 0,
  sent_by        uuid           references public.profiles(id) on delete set null,
  created_at     timestamptz    not null default now()
);

-- ── user_notifications ────────────────────────────────────────
create table public.user_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  body         text not null,
  image_url    text,
  extra_data   jsonb not null default '{}',
  is_read      boolean not null default false,
  campaign_id  uuid references public.notification_campaigns(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ── audit_logs ────────────────────────────────────────────────
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  action      public.audit_action not null,
  table_name  text not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);
