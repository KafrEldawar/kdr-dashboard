-- ============================================================
-- 052: Surface the order's branch on the driver and customer
--      order-detail RPCs.
--
-- Why:
--   • Drivers currently only see the restaurant name. With multi-branch
--     restaurants they don't know which branch to pick the order up
--     from, and there's no map button to navigate there.
--   • Customers see "from <restaurant>" but never the branch they
--     ordered from — when they re-order or call to follow up they have
--     no way to confirm which branch took the order.
--
-- Approach:
--   The orders table has carried `branch_id` since migration 028
--   (geo columns for distance-based delivery fee). This migration
--   extends both `driver_order_json` (used by every driver detail RPC)
--   and `rpc_get_order_detail` (customer detail) to embed a small
--   `branch` object: id, name_ar, name_en, address_ar, address_en,
--   location_url, lat/lng. The mobile app uses those fields to render
--   the branch row and a "افتح في خرائط جوجل" CTA.
--
--   `branch_id` can be null for legacy/pickup orders, so the join is
--   LEFT and the JSON falls back to null. Apps must handle the null.
-- ============================================================

-- ── driver_order_json (add `branch`) ──────────────────────────
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
                           'lng',           coalesce(o.branch_lng, b.lng)
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


-- ── rpc_get_order_detail (add `branch`) ───────────────────────
create or replace function public.rpc_get_order_detail(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_o   jsonb;
begin
  select jsonb_build_object(
    'id', o.id, 'status', o.status,
    'order_type', o.order_type,
    'delivery_by_owner', o.delivery_by_owner,
    'delivery_address', o.delivery_address,
    'contact_phone', o.contact_phone,
    'alternate_phone', o.alternate_phone,
    'notes', o.notes,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee,
    'discount', o.discount, 'total_amount', o.total_amount,
    'accepted_at', o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'rejection_reason', o.rejection_reason,
    'picked_up_at', o.picked_up_at,
    'delivered_at', o.delivered_at,
    'restaurant_rating', o.restaurant_rating,
    'restaurant_review', o.restaurant_review,
    'rated_at', o.rated_at,
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'restaurant', jsonb_build_object(
      'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'logo_url', r.logo_url, 'estimated_delivery_time', r.estimated_delivery_time,
      'phone', coalesce((
        select bp.phone from branch_phones bp
        where bp.branch_id = o.branch_id
        order by bp.id limit 1
      ), '')
    ),
    'branch', case when b.id is null then null else jsonb_build_object(
      'id',            b.id,
      'name_ar',       b.name_ar,
      'name_en',       b.name_en,
      'address_ar',    b.address_ar,
      'address_en',    b.address_en,
      'location_url',  b.location_url,
      'lat',           coalesce(o.branch_lat, b.lat),
      'lng',           coalesce(o.branch_lng, b.lng)
    ) end,
    'driver', case when o.driver_id is null then null else (
      select jsonb_build_object('id', d.id, 'full_name', d.full_name, 'phone', d.phone)
      from profiles d where d.id = o.driver_id
    ) end,
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', oi.id,
         'menu_item_id', oi.menu_item_id,
         'item_name_ar', oi.item_name_ar,
         'item_name_en', oi.item_name_en,
         'price', oi.price,
         'quantity', oi.quantity,
         'special_instructions', oi.special_instructions,
         'subtotal', oi.quantity * oi.price
       ))
       from order_items oi where oi.order_id = o.id),
      '[]'::jsonb
    )
  ) into v_o
  from orders o
  join      restaurants r on r.id = o.restaurant_id
  left join branches    b on b.id = o.branch_id
  where o.id = p_order_id
    and (o.user_id = v_uid
         or o.driver_id = v_uid
         or o.restaurant_id = public.get_my_restaurant_id()
         or public.is_admin());

  return coalesce(v_o, jsonb_build_object('error', 'Order not found or access denied'));
end; $$;
