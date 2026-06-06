-- ============================================================
-- 004: Helper Functions, Triggers, JWT Hook
-- ============================================================

-- ── updated_at trigger function ───────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply updated_at trigger to all relevant tables
create trigger trg_profiles_updated_at    before update on public.profiles    for each row execute function public.set_updated_at();
create trigger trg_categories_updated_at  before update on public.categories  for each row execute function public.set_updated_at();
create trigger trg_restaurants_updated_at before update on public.restaurants for each row execute function public.set_updated_at();
create trigger trg_branches_updated_at    before update on public.branches    for each row execute function public.set_updated_at();
create trigger trg_menu_items_updated_at  before update on public.menu_items  for each row execute function public.set_updated_at();
create trigger trg_offers_updated_at      before update on public.offers      for each row execute function public.set_updated_at();
create trigger trg_orders_updated_at      before update on public.orders      for each row execute function public.set_updated_at();
create trigger trg_carts_updated_at       before update on public.carts       for each row execute function public.set_updated_at();


-- ── auto-create profile on signup ─────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _role public.user_role;
begin
  -- Allow pre-setting role via user_metadata (admin signup flow)
  begin
    _role := (new.raw_user_meta_data->>'role')::public.user_role;
  exception when others then
    _role := 'customer';
  end;

  if _role is null then
    _role := 'customer';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    ),
    _role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── JWT custom access token hook ──────────────────────────────
-- Adds user_role + restaurant_id to JWT claims.
-- IMPORTANT: Register this in Supabase Dashboard → Auth → Hooks
-- Hook type: "Custom Access Token"
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims          jsonb;
  user_role_val   text;
  restaurant_id_val uuid;
begin
  claims := event->'claims';

  select p.role::text into user_role_val
  from public.profiles p
  where p.id = (event->>'user_id')::uuid;

  select ro.restaurant_id into restaurant_id_val
  from public.restaurant_owners ro
  where ro.user_id = (event->>'user_id')::uuid;

  claims := jsonb_set(claims, '{user_role}',
    to_jsonb(coalesce(user_role_val, 'customer')));

  claims := jsonb_set(claims, '{restaurant_id}',
    case when restaurant_id_val is not null
      then to_jsonb(restaurant_id_val::text)
      else 'null'::jsonb
    end
  );

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Permissions for the hook
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;


-- ── Helper functions used in RLS policies ─────────────────────

-- Get current user's role (checks JWT first, falls back to DB)
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt()->>'user_role', ''),
    (select role::text from public.profiles where id = auth.uid())
  );
$$;

-- Is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt()->>'user_role', '') = 'admin',
    exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
$$;

-- Get the restaurant_id owned by the current user
create or replace function public.get_my_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt()->>'restaurant_id', 'null')::uuid,
    (select restaurant_id from public.restaurant_owners where user_id = auth.uid())
  );
$$;

-- Is the current user a restaurant owner?
create or replace function public.is_restaurant_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt()->>'user_role', '') = 'restaurant',
    exists(select 1 from public.profiles where id = auth.uid() and role = 'restaurant')
  );
$$;
