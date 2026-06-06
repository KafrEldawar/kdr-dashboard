-- ============================================================
-- 007: Security Fixes
-- ============================================================

-- Fix mutable search_path on set_updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- Revoke anon/public execute on internal helper functions
revoke execute on function public.is_admin()             from anon, public;
revoke execute on function public.get_my_role()          from anon, public;
revoke execute on function public.get_my_restaurant_id() from anon, public;
revoke execute on function public.is_restaurant_owner()  from anon, public;
revoke execute on function public.handle_new_user()      from anon, public, authenticated;

-- Drop permissive INSERT policies on internal tables
-- (these tables are only written by security definer functions / Edge Functions with service_role)
drop policy if exists "al: insert via rpc"   on public.audit_logs;
drop policy if exists "order_items: insert"  on public.order_items;
drop policy if exists "un: insert allowed"   on public.user_notifications;
