-- ============================================================
-- 001: Extensions + Custom Enums
-- ============================================================

-- Extensions
create extension if not exists "pg_trgm"  with schema extensions;
create extension if not exists "unaccent"  with schema extensions;

-- ── Enums ────────────────────────────────────────────────────

create type public.user_role as enum (
  'customer',
  'restaurant',
  'admin'
);

create type public.gender_type as enum (
  'male',
  'female'
);

create type public.order_status as enum (
  'pending',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled'
);

create type public.discount_type_enum as enum (
  'fixed',
  'percentage'
);

create type public.notification_target as enum (
  'all_customers',
  'all_restaurants',
  'platform_android',
  'platform_ios',
  'custom'
);

create type public.device_platform as enum (
  'android',
  'ios',
  'web'
);

create type public.audit_action as enum (
  'create',
  'update',
  'delete'
);
