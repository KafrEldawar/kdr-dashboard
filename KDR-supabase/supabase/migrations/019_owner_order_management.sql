-- ============================================================
-- 019: Owner Order Status Management
-- ============================================================

-- ── rpc_owner_update_order_status ────────────────────────────
-- Allows a restaurant owner to update the status of an order
-- belonging to their restaurant with validated transitions.
--
-- Valid transitions:
--   pending         → preparing | cancelled
--   preparing       → out_for_delivery | cancelled
--   out_for_delivery→ delivered
create or replace function public.rpc_owner_update_order_status(
  p_order_id  uuid,
  p_new_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid          := auth.uid();
  v_rest_id    uuid          := public.get_my_restaurant_id();
  v_cur_status order_status;
  v_new_status order_status;
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  -- Cast and validate new status value
  begin
    v_new_status := p_new_status::order_status;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid status value: ' || p_new_status);
  end;

  -- Fetch current status and verify ownership
  select o.status into v_cur_status
  from orders o
  where o.id = p_order_id and o.restaurant_id = v_rest_id;

  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  -- Validate transition
  if not (
    (v_cur_status = 'pending'          and v_new_status in ('preparing',        'cancelled')) or
    (v_cur_status = 'preparing'        and v_new_status in ('out_for_delivery',  'cancelled')) or
    (v_cur_status = 'out_for_delivery' and v_new_status = 'delivered')
  ) then
    return jsonb_build_object(
      'error', 'Invalid transition from ' || v_cur_status::text || ' to ' || p_new_status
    );
  end if;

  -- Apply status update
  update orders set status = v_new_status, updated_at = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'orders', p_order_id::text);

  -- Return the updated order row in the same shape as rpc_owner_get_orders
  return (
    select jsonb_build_object(
      'id',               o.id,
      'status',           o.status,
      'total_amount',     o.total_amount,
      'subtotal',         o.subtotal,
      'delivery_fee',     o.delivery_fee,
      'discount',         o.discount,
      'delivery_address', o.delivery_address,
      'contact_phone',    o.contact_phone,
      'notes',            o.notes,
      'created_at',       o.created_at,
      'updated_at',       o.updated_at,
      'items_count',      (select count(*) from order_items oi where oi.order_id = o.id),
      'customer',         jsonb_build_object(
                            'id',        p.id,
                            'full_name', p.full_name,
                            'phone',     p.phone
                          )
    )
    from orders o join profiles p on p.id = o.user_id
    where o.id = p_order_id
  );
end; $$;
