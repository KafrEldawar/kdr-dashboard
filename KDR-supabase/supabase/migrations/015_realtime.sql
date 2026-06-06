-- ============================================================
-- 015: Enable Realtime on key tables
-- ============================================================
-- Clients subscribe with:
--   supabase.channel('orders')
--     .on('postgres_changes', { event: '*', schema: 'public', table: 'orders',
--          filter: `restaurant_id=eq.${rid}` }, cb)
--     .subscribe()

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.user_notifications;
alter publication supabase_realtime add table public.cart_items;
