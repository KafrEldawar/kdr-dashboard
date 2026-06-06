-- ============================================================
-- 003: Performance Indexes
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
create index idx_profiles_role       on public.profiles(role);
create index idx_profiles_is_active  on public.profiles(is_active);

-- ── categories ───────────────────────────────────────────────
create index idx_categories_sort     on public.categories(sort_order, is_active);

-- ── restaurants ───────────────────────────────────────────────
create index idx_restaurants_is_active        on public.restaurants(is_active);
create index idx_restaurants_online_active    on public.restaurants(accepts_online_orders, is_active);
create index idx_restaurants_accepting        on public.restaurants(is_accepting_orders) where is_active = true;
-- Full-text search across Arabic + English
create index idx_restaurants_fts on public.restaurants
  using gin(to_tsvector('simple',
    coalesce(name_ar,'') || ' ' || coalesce(name_en,'') ||
    ' ' || coalesce(description_ar,'') || ' ' || coalesce(description_en,'')
  ));

-- ── restaurant_categories ─────────────────────────────────────
create index idx_rc_category on public.restaurant_categories(category_id);

-- ── restaurant_owners ─────────────────────────────────────────
create index idx_ro_restaurant on public.restaurant_owners(restaurant_id);

-- ── branches ──────────────────────────────────────────────────
create index idx_branches_restaurant on public.branches(restaurant_id);

-- ── menu_items ────────────────────────────────────────────────
create index idx_menu_restaurant      on public.menu_items(restaurant_id, sort_order);
create index idx_menu_category        on public.menu_items(category_id);
create index idx_menu_available       on public.menu_items(is_available, restaurant_id);
create index idx_menu_price           on public.menu_items(price);
create index idx_menu_fts on public.menu_items
  using gin(to_tsvector('simple',
    coalesce(name_ar,'') || ' ' || coalesce(name_en,'') ||
    ' ' || coalesce(description_ar,'') || ' ' || coalesce(description_en,'')
  ));

-- ── offers ────────────────────────────────────────────────────
create index idx_offers_restaurant on public.offers(restaurant_id, is_active);
create index idx_offers_active_date on public.offers(is_active, end_date) where is_active = true;

-- ── vouchers ──────────────────────────────────────────────────
create index idx_vouchers_restaurant on public.vouchers(restaurant_id);
create index idx_vouchers_active     on public.vouchers(is_active, valid_to) where is_active = true;

-- ── cart_items ────────────────────────────────────────────────
create index idx_cart_items_cart      on public.cart_items(cart_id);
create index idx_cart_items_menu_item on public.cart_items(menu_item_id);

-- ── orders ────────────────────────────────────────────────────
create index idx_orders_user          on public.orders(user_id, created_at desc);
create index idx_orders_restaurant    on public.orders(restaurant_id, created_at desc);
create index idx_orders_status        on public.orders(status);
create index idx_orders_created       on public.orders(created_at desc);
create index idx_orders_rated         on public.orders(restaurant_rating) where restaurant_rating is not null;
-- Composite for restaurant owner order list
create index idx_orders_restaurant_status on public.orders(restaurant_id, status, created_at desc);

-- ── order_items ───────────────────────────────────────────────
create index idx_order_items_order on public.order_items(order_id);

-- ── device_tokens ─────────────────────────────────────────────
create index idx_device_tokens_user     on public.device_tokens(user_id, is_active);
create index idx_device_tokens_platform on public.device_tokens(platform, is_active);

-- ── user_notifications ────────────────────────────────────────
create index idx_notifications_user       on public.user_notifications(user_id, created_at desc);
create index idx_notifications_unread     on public.user_notifications(user_id, is_read) where is_read = false;

-- ── audit_logs ────────────────────────────────────────────────
create index idx_audit_user    on public.audit_logs(user_id);
create index idx_audit_table   on public.audit_logs(table_name);
create index idx_audit_created on public.audit_logs(created_at desc);
