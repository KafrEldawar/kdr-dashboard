-- ============================================================
-- 023: Order lifecycle enums — ENUM CHANGES ONLY
-- ============================================================
-- New enum values cannot be referenced in the same transaction
-- that adds them, so this migration contains nothing else.
-- ============================================================

alter type public.order_status add value if not exists 'rejected';
alter type public.order_status add value if not exists 'ready_for_pickup';
alter type public.order_status add value if not exists 'picked_up_by_customer';

alter type public.user_role add value if not exists 'driver';

do $$ begin
  create type public.order_type as enum ('delivery', 'pickup');
exception when duplicate_object then null;
end $$;
