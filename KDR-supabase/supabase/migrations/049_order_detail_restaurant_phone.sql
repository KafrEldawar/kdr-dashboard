-- ============================================================
-- 049: Surface restaurant phone in rpc_get_order_detail
--
-- The mobile customer order detail wants a one-tap dialer next to
-- the restaurant name (especially for self-delivery orders, where
-- the restaurant doubles as the courier). Migration 038 was meant
-- to add the `phone` field to the restaurant block but never got
-- applied to this database — the live function still ships a
-- restaurant block without it.
--
-- Phones live on `branch_phones`, keyed by `branches.id`. We pick
-- the first phone for the order's branch and fall back to any
-- phone registered against any branch of the same restaurant.
-- Empty string when no phone exists anywhere, so the UI can
-- choose to hide the dialer.
-- ============================================================

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
      'phone', coalesce(
        (
          select bp.phone
          from public.branch_phones bp
          where bp.branch_id = o.branch_id
          order by bp.id
          limit 1
        ),
        (
          select bp.phone
          from public.branch_phones bp
          join public.branches b on b.id = bp.branch_id
          where b.restaurant_id = r.id
          order by bp.id
          limit 1
        ),
        ''
      )
    ),
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
  from orders o join restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id
    and (o.user_id = v_uid
         or o.driver_id = v_uid
         or o.restaurant_id = public.get_my_restaurant_id()
         or public.is_admin());

  return coalesce(v_o, jsonb_build_object('error', 'Order not found or access denied'));
end; $$;
