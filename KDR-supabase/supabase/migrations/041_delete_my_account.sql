-- ============================================================
-- 041: Self-service account deletion
-- ============================================================
-- App-store policy (Apple §5.1.1(v), Google Play "Data deletion")
-- requires users to delete their own account from inside the app.
-- This migration:
--
--   1. Relaxes orders.user_id from NOT NULL + RESTRICT to NULL +
--      SET NULL so deleting a customer doesn't fail on order history.
--   2. Rewrites owner_order_json + driver_order_json with LEFT JOIN to
--      cope with the now-nullable customer link (anonymized as
--      "حساب محذوف" in the response).
--   3. Adds rpc_delete_my_account: pre-flight checks (no in-flight
--      orders / no active restaurant ownership), PII anonymization on
--      historical orders, then DELETE FROM auth.users (cascades through
--      profiles, addresses, carts, device_tokens, favourites,
--      notifications).
--
-- Owners can NOT self-delete from the app — cascading on
-- restaurant_owners would orphan the restaurant + menu + commission
-- settings. The RPC returns a "contact support" error for that path.

-- ── 1. Relax orders.user_id ───────────────────────────────────
alter table orders alter column user_id drop not null;

alter table orders drop constraint if exists orders_user_id_fkey;
alter table orders add constraint orders_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;

-- ── 2. JSON helpers: tolerate NULL customer ───────────────────
create or replace function public.owner_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',               o.id,
    'status',           o.status,
    'order_type',       o.order_type,
    'total_amount',     o.total_amount,
    'subtotal',         o.subtotal,
    'delivery_fee',     o.delivery_fee,
    'discount',         o.discount,
    'delivery_address', o.delivery_address,
    'contact_phone',    o.contact_phone,
    'alternate_phone',  o.alternate_phone,
    'notes',            o.notes,
    'accepted_at',      o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'rejection_reason', o.rejection_reason,
    'picked_up_at',     o.picked_up_at,
    'delivered_at',     o.delivered_at,
    'created_at',       o.created_at,
    'updated_at',       o.updated_at,
    'items_count',      (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',         jsonb_build_object(
                          'id',        p.id,
                          'full_name', coalesce(p.full_name, 'حساب محذوف'),
                          'phone',     p.phone
                        ),
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
  from orders o
  left join profiles p on p.id = o.user_id
  where o.id = p_order_id;
$$;

create or replace function public.driver_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',               o.id,
    'status',           o.status,
    'order_type',       o.order_type,
    'total_amount',     o.total_amount,
    'subtotal',         o.subtotal,
    'delivery_fee',     o.delivery_fee,
    'discount',         o.discount,
    'delivery_address', o.delivery_address,
    'contact_phone',    o.contact_phone,
    'alternate_phone',  o.alternate_phone,
    'notes',            o.notes,
    'accepted_at',      o.accepted_at,
    'estimated_preparation_minutes', o.estimated_preparation_minutes,
    'claimed_at',       o.claimed_at,
    'picked_up_at',     o.picked_up_at,
    'delivered_at',     o.delivered_at,
    'created_at',       o.created_at,
    'updated_at',       o.updated_at,
    'driver_id',        o.driver_id,
    'items_count',      (select count(*) from order_items oi where oi.order_id = o.id),
    'customer',         jsonb_build_object(
                          'id',        p.id,
                          'full_name', coalesce(p.full_name, 'حساب محذوف'),
                          'phone',     p.phone
                        ),
    'restaurant',       jsonb_build_object(
                          'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
                          'logo_url', r.logo_url),
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
  left join profiles p on p.id = o.user_id
  join restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id;
$$;

-- ── 3. rpc_delete_my_account ──────────────────────────────────
create or replace function public.rpc_delete_my_account()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid  uuid := auth.uid();
  v_role user_role;
  v_inflight integer;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select role into v_role from profiles where id = v_uid;
  if not found then
    return jsonb_build_object('error', 'Profile not found');
  end if;

  -- Customer: refuse if any non-terminal order is still in flight.
  if v_role = 'customer' then
    select count(*) into v_inflight
    from orders
    where user_id = v_uid
      and status not in ('delivered','picked_up_by_customer','cancelled','rejected');
    if v_inflight > 0 then
      return jsonb_build_object(
        'error', 'pending_orders',
        'message', 'لا يمكن حذف الحساب وعندك طلبات نشطة. أكمل أو ألغِ طلباتك أولاً.'
      );
    end if;
  end if;

  -- Driver: refuse if any active delivery is still on their plate.
  if v_role = 'driver' then
    select count(*) into v_inflight
    from orders
    where driver_id = v_uid
      and status in ('preparing','ready_for_pickup','out_for_delivery');
    if v_inflight > 0 then
      return jsonb_build_object(
        'error', 'pending_deliveries',
        'message', 'لا يمكن حذف الحساب وعندك طلبات توصيل نشطة. سلّمها أولاً.'
      );
    end if;
  end if;

  -- Restaurant owner: blocked from the app — cascading the ownership
  -- row would orphan the restaurant + menu + commission settings.
  -- Funnel them to support for a manual close/transfer.
  if v_role = 'restaurant' then
    if exists (select 1 from restaurant_owners where user_id = v_uid) then
      return jsonb_build_object(
        'error', 'owner_must_contact_support',
        'message', 'لا يمكن حذف حساب صاحب المطعم من التطبيق. تواصل مع الدعم لإغلاق المطعم أو نقل الملكية.'
      );
    end if;
  end if;

  -- Anonymize PII on retained order history before the user vanishes.
  -- The orders themselves stay for accounting; the customer link goes
  -- NULL via the SET NULL cascade once auth.users is deleted, and these
  -- text columns get scrubbed here.
  if v_role = 'customer' then
    update orders
       set contact_phone    = null,
           alternate_phone  = null,
           delivery_address = null,
           notes            = null
     where user_id = v_uid;
  end if;

  -- Audit BEFORE delete so we keep a permanent record (user_id FK is
  -- SET NULL, but the row + new_data payload survive forever).
  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'delete', 'profiles', v_uid::text,
    jsonb_build_object('action','self_delete','role',v_role,'at',now()));

  -- The big hammer. auth.users cascades to profiles (which cascades to
  -- carts/device_tokens/addresses/favourites/notifications). Sessions,
  -- identities, MFA factors all clean up via the auth schema's own
  -- triggers.
  delete from auth.users where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.rpc_delete_my_account() from anon, public;
grant  execute on function public.rpc_delete_my_account() to authenticated;
