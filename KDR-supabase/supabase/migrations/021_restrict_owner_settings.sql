-- ============================================================
-- 021: Restrict owner restaurant settings
--      Owner can only toggle is_accepting_orders and delivery config.
--      accepts_online_orders is admin-only.
-- ============================================================

-- Replace the existing function without p_accepts_online_orders parameter
create or replace function public.rpc_owner_update_restaurant_settings(
  p_is_accepting_orders   boolean default null,
  p_delivery_fee          numeric default null,
  p_min_order_amount      numeric default null,
  p_estimated_delivery_time integer default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  update restaurants set
    is_accepting_orders     = coalesce(p_is_accepting_orders,    is_accepting_orders),
    delivery_fee            = coalesce(p_delivery_fee,           delivery_fee),
    min_order_amount        = coalesce(p_min_order_amount,       min_order_amount),
    estimated_delivery_time = coalesce(p_estimated_delivery_time, estimated_delivery_time),
    updated_at              = now()
  where id = v_rest_id;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'restaurants', v_rest_id::text);

  return (
    select jsonb_build_object(
      'id',                     r.id,
      'name_ar',                r.name_ar,
      'name_en',                r.name_en,
      'logo_url',               r.logo_url,
      'cover_url',              r.cover_url,
      'is_accepting_orders',    r.is_accepting_orders,
      'accepts_online_orders',  r.accepts_online_orders,
      'delivery_fee',           r.delivery_fee,
      'min_order_amount',       r.min_order_amount,
      'estimated_delivery_time', r.estimated_delivery_time
    )
    from restaurants r where r.id = v_rest_id
  );
end; $$;
