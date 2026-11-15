create role authenticated nologin; create role anon nologin; create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid(), auth.jwt() to authenticated, anon, service_role;

create type public.order_status as enum ('pending','preparing','out_for_delivery','delivered','cancelled','rejected','ready_for_pickup','picked_up_by_customer');
create type public.order_type as enum ('delivery','pickup');
create type public.gender_type as enum ('male','female');

create table public.profiles (id uuid primary key, role text not null default 'customer', is_tester boolean not null default false,
  phone text, phone_verified_at timestamptz, alternate_phone text, full_name text, gender public.gender_type, avatar_url text, updated_at timestamptz);
create unique index on public.profiles(phone) where phone is not null;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(nullif(auth.jwt()->>'user_role', '') = 'admin', exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')); $$;
revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated, service_role;

create or replace function public.normalize_eg_phone(p_input text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_input is null then return null; end if;
  v := pg_catalog.regexp_replace(p_input, '[\s\-\(\)\.]', '', 'g');
  if v = '' then return null; end if;
  if pg_catalog.left(v, 1) = '+' then v := pg_catalog.substr(v, 2);
  elsif pg_catalog.left(v, 2) = '00' then v := pg_catalog.substr(v, 3); end if;
  if v ~ '^01[0-25]\d{8}$' then v := '20' || pg_catalog.substr(v, 2);
  elsif v ~ '^1[0-25]\d{8}$' then v := '20' || v; end if;
  if v !~ '^\d{10,15}$' then return null; end if;
  return '+' || v;
end; $$;
grant execute on function public.normalize_eg_phone(text) to authenticated, anon;

create or replace function public.rpc_get_my_profile() returns jsonb language sql security definer set search_path = public as $$
  select to_jsonb(p) from profiles p where id = auth.uid(); $$;

create table public.restaurants (id uuid primary key, accepts_online_orders boolean, is_accepting_orders boolean, commission_percentage numeric(5,2));
create table public.menu_items (id uuid primary key, restaurant_id uuid references public.restaurants, price numeric(10,2), is_available boolean not null default true, name_en text, name_ar text);
create table public.menu_item_variants (id uuid primary key, menu_item_id uuid references public.menu_items, price numeric(10,2), is_available boolean not null default true, name_ar text, name_en text);
create table public.menu_addons (id uuid primary key, price_delta numeric(10,2), is_available boolean not null default true, name_ar text, name_en text, sort_order int default 0);
create table public.carts (id uuid primary key default gen_random_uuid(), user_id uuid unique);
create table public.cart_items (id uuid primary key default gen_random_uuid(), cart_id uuid references public.carts, menu_item_id uuid references public.menu_items, variant_id uuid, addon_ids uuid[] default '{}', quantity int, special_instructions text);
create table public.branches (id uuid primary key, restaurant_id uuid, lat double precision, lng double precision);
create table public.user_addresses (id uuid primary key, user_id uuid, address_ar text, lat double precision, lng double precision);
create table public.vouchers (id uuid primary key, code text, restaurant_id uuid, is_active boolean, valid_from timestamptz, valid_to timestamptz,
  usage_limit int, used_count int not null default 0, min_order_amount numeric(10,2) default 0, discount_type text, discount_value numeric(10,2));
create table public.orders (id uuid primary key default gen_random_uuid(), user_id uuid, restaurant_id uuid, status public.order_status, order_type public.order_type,
  delivery_address text, contact_phone text, alternate_phone text, notes text, subtotal numeric(10,2), delivery_fee numeric(10,2), discount numeric(10,2), total_amount numeric(10,2),
  commission_percentage numeric(5,2), commission_gross numeric(10,2), commission_amount numeric(10,2), discount_platform_share numeric(10,2), discount_restaurant_share numeric(10,2),
  restaurant_revenue numeric(10,2), voucher_id uuid, branch_id uuid, delivery_address_id uuid, branch_lat double precision, branch_lng double precision,
  delivery_lat double precision, delivery_lng double precision, delivery_distance_km numeric(6,2));
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid references public.orders, menu_item_id uuid, item_name_en text, item_name_ar text,
  price numeric(10,2), base_price numeric(10,2), quantity int, special_instructions text, variant_id uuid, variant_name_ar text, variant_name_en text, addons jsonb);
create table public.audit_logs (id uuid primary key default gen_random_uuid(), user_id uuid, action text, table_name text, record_id text, new_data jsonb);
create table public.user_notifications (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.user_favorite_restaurants (user_id uuid, restaurant_id uuid);
alter table public.order_items enable row level security; alter table public.user_notifications enable row level security;
alter table public.audit_logs enable row level security; alter table public.user_favorite_restaurants enable row level security;
create policy "order_items: insert via rpc" on public.order_items for insert with check (true);
create policy "user_notifications: insert allowed" on public.user_notifications for insert with check (true);
create policy "audit_logs: insert via rpc" on public.audit_logs for insert with check (true);
create policy "favorites: user manages own" on public.user_favorite_restaurants for all using (user_id = auth.uid() or public.is_admin());
create policy "favorites: public count visible" on public.user_favorite_restaurants for select using (true);

grant select, update on public.profiles to authenticated;
grant all on public.order_items, public.user_notifications, public.audit_logs, public.user_favorite_restaurants to authenticated, anon;

create or replace function public.compute_delivery_fee(p_branch_id uuid, p_address_id uuid)
returns table (distance_km numeric, fee numeric, in_range boolean, needs_pin boolean, branch_needs_pin boolean, currency text)
language sql stable as $$ select 3.0::numeric, 25::numeric, true, false, false, 'EGP'::text $$;

create or replace function public._menu_line_price(p_menu_item_id uuid, p_variant_id uuid default null, p_addon_ids uuid[] default '{}'::uuid[])
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select v.price from menu_item_variants v where v.id = p_variant_id and v.menu_item_id = p_menu_item_id),
                  (select mi.price from menu_items mi where mi.id = p_menu_item_id), 0)
       + coalesce((select sum(a.price_delta) from menu_addons a where a.id = any(coalesce(p_addon_ids, '{}'::uuid[]))), 0); $$;
create or replace function public._addons_json(p_addon_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'price_delta', a.price_delta)) from menu_addons a where a.id = any(coalesce(p_addon_ids, '{}'::uuid[]))), '[]'::jsonb); $$;
create or replace function public.rpc_get_order_detail(p_order_id uuid) returns jsonb language sql security definer set search_path = public as $$
  select to_jsonb(o) from orders o where id = p_order_id; $$;
