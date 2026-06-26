-- ============================================================
-- 048: Let self-delivery owners close their own deliveries
--
-- The `enforce_owner_post_handoff_lock` trigger (added by the
-- "tighten_owner_order_status_gating" migration) blocks any owner
-- update on an order whose status is already past hand-off:
--
--   out_for_delivery, delivered, picked_up_by_customer,
--   rejected, cancelled
--
-- That's correct for the courier flow — once the food is on a
-- driver, the owner shouldn't be able to flip the status.
--
-- Self-delivery breaks that assumption: when delivery_by_owner is
-- true the owner IS the courier, so the `out_for_delivery →
-- delivered` step must come from the owner. Without this fix the
-- "تم التسليم" button on the owner detail screen always returns
-- "restaurant cannot modify an order after it has been handed off"
-- via the trigger, even though rpc_owner_update_order_status would
-- otherwise allow the transition.
--
-- We carve out a narrow exception: when delivery_by_owner is true,
-- the only post-handoff status we let the owner change is
-- out_for_delivery, and only to 'delivered'. Every other locked
-- state stays locked, so an owner still can't reopen a delivered
-- or cancelled order.
-- ============================================================

create or replace function public.enforce_owner_post_handoff_lock()
returns trigger language plpgsql as $$
begin
  if public.is_restaurant_owner()
     and not public.is_admin()
     and old.status in (
       'out_for_delivery',
       'delivered',
       'picked_up_by_customer',
       'rejected',
       'cancelled'
     )
     and new.status is distinct from old.status
     and not (
       old.delivery_by_owner
       and old.status = 'out_for_delivery'
       and new.status = 'delivered'
     )
  then
    raise exception
      'restaurant cannot modify an order after it has been handed off (current status: %)',
      old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
