-- ============================================================
-- 066: Surface the customer's exact delivery pin on the driver
--      and owner order-detail JSONs.
--
-- Why:
--   Both apps built their "open in Google Maps" links from the
--   free-text `orders.delivery_address`, which is a reverse-geocoded
--   string that is frequently only neighbourhood-level — e.g.
--   "النشو البحري, البحيرة, 22631, مصر". A Maps *search* on that text
--   drops the driver at the centroid of a whole village instead of
--   the customer's door.
--
--   Meanwhile `orders.delivery_lat/lng` (added in migration 028 and
--   populated by rpc_checkout since 032) holds the exact pin the
--   customer dropped — every delivery order on production has it —
--   but neither JSON ever returned it, so the clients could not use it.
--
--   This migration only ADDS keys. Existing keys, argument lists,
--   return types and grants are untouched, so app builds already in
--   the store keep working exactly as before.
--
-- Note: `branch.lat/lng` was already exposed by migration 053; the
--   driver app just wasn't reading it. No backend change needed there.
-- ============================================================

-- ── driver_order_json ─────────────────────────────────────────
-- Verbatim copy of the migration-053 body + delivery_lat/delivery_lng.
create or replace function public.driver_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                o.id,
    'status',            o.status,
    'order_type',        o.order_type,
    'delivery_by_owner', o.delivery_by_owner,
    'total_amount',      o.total_amount,
    'subtotal',          o.subtotal,
    'delivery_fee',      o.delivery_fee,
    'discount',          o.discount,
    'delivery_address',  o.delivery_address,
    'delivery_lat',      o.delivery_lat,
    'delivery_lng',      o.delivery_lng,
    'contact_phone',     o.contact_phone,
    'alternate_phone',   o.alternate_phone,
    'notes',             o.notes,
    'accepted_at',       o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'claimed_at',        o.claimed_at,
    'picked_up_at',      o.picked_up_at,
    'delivered_at',      o.delivered_at,
    'created_at',        o.created_at,
    'updated_at',        o.updated_at,
    'driver_id',         o.driver_id,
    'items_count',       (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',          jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
    'restaurant',        jsonb_build_object(
                           'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
                           'logo_url', r.logo_url),
    'branch', case when b.id is null then null else jsonb_build_object(
                           'id',            b.id,
                           'name_ar',       b.name_ar,
                           'name_en',       b.name_en,
                           'address_ar',    b.address_ar,
                           'address_en',    b.address_en,
                           'location_url',  b.location_url,
                           'lat',           coalesce(o.branch_lat, b.lat),
                           'lng',           coalesce(o.branch_lng, b.lng),
                           'phone',         coalesce((
                             select bp.phone from branch_phones bp
                             where bp.branch_id = b.id
                             order by bp.id limit 1
                           ), '')
                         ) end,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                   oi.id,
          'name_ar',              oi.item_name_ar,
          'name_en',              oi.item_name_en,
          'price',                oi.price,
          'quantity',             oi.quantity,
          'special_instructions', oi.special_instructions
        )
      ), '[]'::jsonb)
      from order_items oi where oi.order_id = o.id
    )
  )
  from orders o
  left join profiles p   on p.id = o.user_id
  join      restaurants r on r.id = o.restaurant_id
  left join branches    b on b.id = o.branch_id
  where o.id = p_order_id;
$$;

revoke execute on function public.driver_order_json(uuid) from anon, public;

-- ── owner_order_json ──────────────────────────────────────────
-- Same treatment for the restaurant-owner order detail, whose
-- "خرائط جوجل" / "مشاركة" buttons had the identical problem.
create or replace function public.owner_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                        o.id,
    'status',                    o.status,
    'order_type',                o.order_type,
    'delivery_by_owner',         o.delivery_by_owner,
    'total_amount',              o.total_amount,
    'subtotal',                  o.subtotal,
    'delivery_fee',              o.delivery_fee,
    'discount',                  o.discount,
    'commission_percentage',     o.commission_percentage,
    'commission_gross',          o.commission_gross,
    'commission_amount',         o.commission_amount,
    'discount_platform_share',   o.discount_platform_share,
    'discount_restaurant_share', o.discount_restaurant_share,
    'restaurant_revenue',        o.restaurant_revenue,
    'delivery_address',          o.delivery_address,
    'delivery_lat',              o.delivery_lat,
    'delivery_lng',              o.delivery_lng,
    'contact_phone',             o.contact_phone,
    'alternate_phone',           o.alternate_phone,
    'notes',                     o.notes,
    'accepted_at',               o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'rejection_reason',          o.rejection_reason,
    'picked_up_at',              o.picked_up_at,
    'delivered_at',              o.delivered_at,
    'created_at',                o.created_at,
    'updated_at',                o.updated_at,
    'items_count',               (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',                  jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
    'driver', case when o.driver_id is null then null else (
      select jsonb_build_object('id', d.id, 'full_name', d.full_name, 'phone', d.phone)
      from profiles d where d.id = o.driver_id
    ) end,
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                   oi.id,
          'name_ar',              oi.item_name_ar,
          'name_en',              oi.item_name_en,
          'price',                oi.price,
          'quantity',             oi.quantity,
          'special_instructions', oi.special_instructions
        )
      ), '[]'::jsonb)
      from order_items oi where oi.order_id = o.id
    )
  )
  from orders o left join profiles p on p.id = o.user_id
  where o.id = p_order_id;
$$;

revoke execute on function public.owner_order_json(uuid) from anon, public;
