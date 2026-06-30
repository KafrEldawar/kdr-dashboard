-- ============================================================
-- 053: Surface the pickup branch's first phone number on the
--      driver order detail JSON.
--
-- Why:
--   Drivers asked for a one-tap dial to the branch so they can
--   confirm "is it ready?" before riding over — especially useful
--   for multi-branch restaurants where the wrong branch is the
--   single most common source of pickup confusion. Migration 052
--   already added the `branch` object; this one extends it with
--   `phone` (first row from `branch_phones` for the order's branch).
-- ============================================================

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
