-- ============================================================
-- 039: Driver history + availability flag
--
-- * Adds an `is_available` flag to profiles, driver-side toggle that
--   pauses new-order notifications and excludes the driver from the
--   pool-broadcast list. RLS already lets every authenticated user
--   update their own profile row, so no policy change needed.
--
-- * Adds `rpc_driver_get_history(p_page, p_page_size)` — paginated
--   list of the driver's terminated deliveries (delivered / cancelled).
--   Reuses `driver_order_json` so the response shape matches the
--   active-orders feed, keeping the Flutter model identical.
--
-- * Adds `rpc_driver_set_availability(p_is_available boolean)` —
--   single-source-of-truth setter used by the driver profile toggle.
-- ============================================================

-- ── profiles.is_available ─────────────────────────────────────
alter table public.profiles
  add column if not exists is_available boolean not null default true;

-- Existing drivers stay available by default — the column is also
-- harmless on customer/restaurant/admin rows (never read for them).

-- ── rpc_driver_set_availability ───────────────────────────────
create or replace function public.rpc_driver_set_availability(
  p_is_available boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  update public.profiles
     set is_available = p_is_available,
         updated_at   = now()
   where id = v_uid;

  return jsonb_build_object('is_available', p_is_available);
end;
$$;

grant execute on function public.rpc_driver_set_availability(boolean) to authenticated;

-- ── rpc_driver_get_history ────────────────────────────────────
create or replace function public.rpc_driver_get_history(
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid    := auth.uid();
  v_offset integer := greatest(0, (p_page - 1) * p_page_size);
  v_total  integer;
  v_data   jsonb;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select count(*) into v_total
  from public.orders
  where driver_id = v_uid
    and status in ('delivered', 'cancelled', 'rejected');

  select coalesce(jsonb_agg(public.driver_order_json(o.id) order by o.updated_at desc), '[]'::jsonb)
    into v_data
  from (
    select id, updated_at
    from public.orders
    where driver_id = v_uid
      and status in ('delivered', 'cancelled', 'rejected')
    order by updated_at desc
    limit p_page_size offset v_offset
  ) o;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object(
      'total',       v_total,
      'page',        p_page,
      'page_size',   p_page_size,
      'total_pages', ceil(v_total::numeric / greatest(p_page_size, 1))
    )
  );
end;
$$;

grant execute on function public.rpc_driver_get_history(integer, integer) to authenticated;

-- ── rpc_driver_get_available_orders (override) ────────────────
-- Re-defining the available-pool RPC here to short-circuit the query
-- when the driver has flipped themselves to unavailable. Same return
-- shape as 026 so the Flutter data source needs no changes.
create or replace function public.rpc_driver_get_available_orders(
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid    := auth.uid();
  v_offset    integer := (p_page - 1) * p_page_size;
  v_total     integer;
  v_data      jsonb;
  v_available boolean;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'Not a driver');
  end if;

  select is_available into v_available from public.profiles where id = v_uid;
  if coalesce(v_available, true) = false then
    return jsonb_build_object(
      'data', '[]'::jsonb,
      'meta', jsonb_build_object(
        'total', 0, 'page', p_page, 'page_size', p_page_size,
        'total_pages', 0
      )
    );
  end if;

  select count(*) into v_total from public.orders
  where driver_id is null
    and order_type = 'delivery'
    and status in ('preparing', 'ready_for_pickup');

  select coalesce(jsonb_agg(public.driver_order_json(o.id) order by o.created_at desc), '[]'::jsonb)
  into v_data
  from (
    select id, created_at from public.orders
    where driver_id is null
      and order_type = 'delivery'
      and status in ('preparing', 'ready_for_pickup')
    order by created_at desc
    limit p_page_size offset v_offset
  ) o;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object(
      'total',       v_total,
      'page',        p_page,
      'page_size',   p_page_size,
      'total_pages', ceil(v_total::numeric / greatest(p_page_size, 1))
    )
  );
end;
$$;

grant execute on function public.rpc_driver_get_available_orders(integer, integer) to authenticated;
