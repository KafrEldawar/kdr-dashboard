-- ============================================================
-- 030: Delivery distance + fee RPCs
--   - haversine_km            : great-circle distance helper
--   - compute_delivery_fee    : canonical fee calc (server source
--                                of truth, called by both the
--                                cart preview and rpc_checkout)
--   - get_delivery_config     : public read of the formula values
-- ============================================================

-- ── haversine_km ──────────────────────────────────────────────
-- Straight-line distance in km between two (lat,lng) pairs.
create or replace function public.haversine_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns numeric
language sql
immutable
parallel safe
as $$
  select round(
    (
      2 * 6371 * asin(
        sqrt(
          power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
          cos(radians(p_lat1)) * cos(radians(p_lat2)) *
          power(sin(radians(p_lng2 - p_lng1) / 2), 2)
        )
      )
    )::numeric,
    3
  )
$$;

-- ── get_delivery_config ───────────────────────────────────────
-- Returns the canonical jsonb the client uses to render the
-- breakdown ("base + per_km × distance"). RLS already lets any
-- authenticated user select from app_settings.
create or replace function public.get_delivery_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.app_settings where key = 'delivery_fee_config';
$$;

grant execute on function public.get_delivery_config() to authenticated;

-- ── compute_delivery_fee ──────────────────────────────────────
-- Pure read-only fee calc. Called by:
--   (a) Flutter DeliveryFeeCubit to render the cart preview.
--   (b) rpc_checkout (migration 032) to validate the order.
--
-- Returns one row:
--   distance_km : numeric  -- haversine × route_factor (rounded)
--   fee         : numeric  -- 0 when out_of_range or needs_pin
--   in_range    : boolean  -- false when distance > max_distance_km
--   needs_pin   : boolean  -- true when branch/address lacks lat/lng
--   currency    : text     -- copied from config
create or replace function public.compute_delivery_fee(
  p_branch_id  uuid,
  p_address_id uuid
)
returns table (
  distance_km numeric,
  fee         numeric,
  in_range    boolean,
  needs_pin   boolean,
  currency    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b_lat   double precision;
  v_b_lng   double precision;
  v_a_lat   double precision;
  v_a_lng   double precision;
  v_cfg     jsonb;
  v_raw_km  numeric;
  v_dist_km numeric;
  v_fee     numeric;
  v_base    numeric;
  v_per_km  numeric;
  v_min     numeric;
  v_max     numeric;
  v_factor  numeric;
  v_maxd    numeric;
  v_curr    text;
begin
  select value into v_cfg from public.app_settings where key = 'delivery_fee_config';
  if v_cfg is null then
    raise exception 'delivery_fee_config missing from app_settings';
  end if;

  v_base   := (v_cfg ->> 'base')::numeric;
  v_per_km := (v_cfg ->> 'per_km')::numeric;
  v_min    := (v_cfg ->> 'min')::numeric;
  v_max    := (v_cfg ->> 'max')::numeric;
  v_factor := coalesce((v_cfg ->> 'route_factor')::numeric, 1.0);
  v_maxd   := (v_cfg ->> 'max_distance_km')::numeric;
  v_curr   := coalesce(v_cfg ->> 'currency', 'EGP');

  select b.lat, b.lng into v_b_lat, v_b_lng
  from public.branches b where b.id = p_branch_id;

  select a.lat, a.lng into v_a_lat, v_a_lng
  from public.user_addresses a where a.id = p_address_id;

  if v_b_lat is null or v_b_lng is null or v_a_lat is null or v_a_lng is null then
    return query select
      0::numeric,
      0::numeric,
      false,
      true,
      v_curr;
    return;
  end if;

  v_raw_km  := public.haversine_km(v_b_lat, v_b_lng, v_a_lat, v_a_lng);
  v_dist_km := round((v_raw_km * v_factor)::numeric, 2);

  if v_dist_km > v_maxd then
    return query select
      v_dist_km,
      0::numeric,
      false,
      false,
      v_curr;
    return;
  end if;

  v_fee := v_base + (v_per_km * v_dist_km);
  v_fee := greatest(v_min, least(v_max, v_fee));
  v_fee := round(v_fee, 2);

  return query select
    v_dist_km,
    v_fee,
    true,
    false,
    v_curr;
end;
$$;

grant execute on function public.compute_delivery_fee(uuid, uuid) to authenticated;
