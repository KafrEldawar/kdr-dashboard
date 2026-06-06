-- ============================================================
-- 005: Row Level Security Policies
-- ============================================================

-- Enable RLS on all public tables
alter table public.profiles               enable row level security;
alter table public.categories             enable row level security;
alter table public.restaurants            enable row level security;
alter table public.restaurant_categories  enable row level security;
alter table public.restaurant_owners      enable row level security;
alter table public.branches               enable row level security;
alter table public.branch_phones          enable row level security;
alter table public.menu_items             enable row level security;
alter table public.restaurant_gallery     enable row level security;
alter table public.offers                 enable row level security;
alter table public.vouchers               enable row level security;
alter table public.carts                  enable row level security;
alter table public.cart_items             enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.device_tokens          enable row level security;
alter table public.notification_campaigns enable row level security;
alter table public.user_notifications     enable row level security;
alter table public.audit_logs             enable row level security;


-- ── profiles ─────────────────────────────────────────────────
create policy "profiles: user reads own"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles: user updates own"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- prevent self-role escalation
    and (role = (select role from public.profiles where id = auth.uid()))
  );

create policy "profiles: admin full access"
  on public.profiles for all
  using (public.is_admin());


-- ── categories ───────────────────────────────────────────────
create policy "categories: public read"
  on public.categories for select using (true);

create policy "categories: admin manage"
  on public.categories for all using (public.is_admin());


-- ── restaurants ───────────────────────────────────────────────
create policy "restaurants: public read active"
  on public.restaurants for select
  using (is_active = true or public.is_admin() or id = public.get_my_restaurant_id());

create policy "restaurants: admin full access"
  on public.restaurants for all
  using (public.is_admin());

create policy "restaurants: owner update own"
  on public.restaurants for update
  using (id = public.get_my_restaurant_id())
  with check (id = public.get_my_restaurant_id());


-- ── restaurant_categories ─────────────────────────────────────
create policy "restaurant_categories: public read"
  on public.restaurant_categories for select using (true);

create policy "restaurant_categories: admin manage"
  on public.restaurant_categories for all using (public.is_admin());

create policy "restaurant_categories: owner manage own"
  on public.restaurant_categories for all
  using (restaurant_id = public.get_my_restaurant_id());


-- ── restaurant_owners ─────────────────────────────────────────
create policy "restaurant_owners: admin full access"
  on public.restaurant_owners for all using (public.is_admin());

create policy "restaurant_owners: owner reads own"
  on public.restaurant_owners for select
  using (user_id = auth.uid());


-- ── branches ──────────────────────────────────────────────────
create policy "branches: public read"
  on public.branches for select using (true);

create policy "branches: admin manage"
  on public.branches for all using (public.is_admin());

create policy "branches: owner manage own"
  on public.branches for all
  using (restaurant_id = public.get_my_restaurant_id());


-- ── branch_phones ─────────────────────────────────────────────
create policy "branch_phones: public read"
  on public.branch_phones for select using (true);

create policy "branch_phones: admin manage"
  on public.branch_phones for all using (public.is_admin());

create policy "branch_phones: owner manage own"
  on public.branch_phones for all
  using (
    branch_id in (
      select id from public.branches
      where restaurant_id = public.get_my_restaurant_id()
    )
  );


-- ── menu_items ────────────────────────────────────────────────
create policy "menu_items: public read available"
  on public.menu_items for select
  using (
    is_available = true
    or public.is_admin()
    or restaurant_id = public.get_my_restaurant_id()
  );

create policy "menu_items: admin manage"
  on public.menu_items for all using (public.is_admin());

create policy "menu_items: owner manage own"
  on public.menu_items for all
  using (restaurant_id = public.get_my_restaurant_id());


-- ── restaurant_gallery ────────────────────────────────────────
create policy "gallery: public read"
  on public.restaurant_gallery for select using (true);

create policy "gallery: admin manage"
  on public.restaurant_gallery for all using (public.is_admin());

create policy "gallery: owner manage own"
  on public.restaurant_gallery for all
  using (restaurant_id = public.get_my_restaurant_id());


-- ── offers ────────────────────────────────────────────────────
create policy "offers: public read active"
  on public.offers for select
  using (
    is_active = true
    or public.is_admin()
    or restaurant_id = public.get_my_restaurant_id()
  );

create policy "offers: admin manage"
  on public.offers for all using (public.is_admin());

create policy "offers: owner manage own"
  on public.offers for all
  using (restaurant_id = public.get_my_restaurant_id());


-- ── vouchers ──────────────────────────────────────────────────
create policy "vouchers: authenticated reads active"
  on public.vouchers for select
  using (
    (is_active = true and valid_to >= now())
    or public.is_admin()
    or restaurant_id = public.get_my_restaurant_id()
  );

create policy "vouchers: admin manage"
  on public.vouchers for all using (public.is_admin());

create policy "vouchers: owner manage own"
  on public.vouchers for all
  using (restaurant_id = public.get_my_restaurant_id());


-- ── carts ─────────────────────────────────────────────────────
create policy "carts: user owns cart"
  on public.carts for all using (user_id = auth.uid());


-- ── cart_items ────────────────────────────────────────────────
create policy "cart_items: user owns items"
  on public.cart_items for all
  using (
    cart_id in (
      select id from public.carts where user_id = auth.uid()
    )
  );


-- ── orders ────────────────────────────────────────────────────
create policy "orders: customer reads own"
  on public.orders for select
  using (
    user_id = auth.uid()
    or restaurant_id = public.get_my_restaurant_id()
    or public.is_admin()
  );

-- Insert handled by security definer RPC function (checkout)
create policy "orders: rpc insert allowed"
  on public.orders for insert
  with check (user_id = auth.uid());

-- Restaurant owner updates status; customer updates rating
create policy "orders: owner or customer update"
  on public.orders for update
  using (
    restaurant_id = public.get_my_restaurant_id()
    or user_id = auth.uid()
    or public.is_admin()
  );


-- ── order_items ───────────────────────────────────────────────
create policy "order_items: read own orders"
  on public.order_items for select
  using (
    order_id in (
      select id from public.orders
      where user_id = auth.uid()
         or restaurant_id = public.get_my_restaurant_id()
    )
    or public.is_admin()
  );

-- Insert via security definer checkout function only
create policy "order_items: insert via rpc"
  on public.order_items for insert
  with check (true);


-- ── device_tokens ─────────────────────────────────────────────
create policy "device_tokens: user manages own"
  on public.device_tokens for all
  using (user_id = auth.uid());

create policy "device_tokens: admin reads all"
  on public.device_tokens for select
  using (public.is_admin());


-- ── notification_campaigns ────────────────────────────────────
create policy "campaigns: admin full access"
  on public.notification_campaigns for all
  using (public.is_admin());

create policy "campaigns: anyone reads"
  on public.notification_campaigns for select
  using (true);


-- ── user_notifications ────────────────────────────────────────
create policy "user_notifications: user reads own"
  on public.user_notifications for select
  using (user_id = auth.uid() or public.is_admin());

create policy "user_notifications: user updates own"
  on public.user_notifications for update
  using (user_id = auth.uid());

-- Insert via security definer functions (send-push edge fn or RPC)
create policy "user_notifications: insert allowed"
  on public.user_notifications for insert
  with check (true);


-- ── audit_logs ────────────────────────────────────────────────
create policy "audit_logs: admin reads"
  on public.audit_logs for select
  using (public.is_admin());

-- Inserts only via security definer functions
create policy "audit_logs: insert via rpc"
  on public.audit_logs for insert
  with check (true);
