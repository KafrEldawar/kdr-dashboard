-- ============================================================
-- 077 — مكاتب التوصيل: إيقاف الاستقبال + إسناد الطلبات
--
-- مشكلتان في فلو المكتب:
--
-- 1) `rpc_driver_set_availability` (نسخة 067) بترفض إيقاف الاستقبال طول
--    ما فيه أي طلب شغّال على الحساب. القاعدة دي منطقية للطيار الفردي
--    (سعته طلب واحد، فإيقاف الاستقبال وهو ماسك طلب مالوش معنى)، لكنها
--    بتقفل الزرار **نهائياً** على المكتب: المكتب طبيعته إنه ماسك طلبات
--    طول اليوم وبيوزّعها على طيارينه، فـ«قافل دلوقتي» بقت مستحيلة عملياً
--    وكانت بترجع `has_active_orders` كإيرور خام.
--
--    الإصلاح: المكتب مُعفى من الحارس ده. إيقاف الاستقبال معناه «مفيش
--    طلبات جديدة تدخل عندي» — الطلبات اللي تحت إيده بتفضل زي ما هي
--    وبيقفلها عادي (`is_available` مالهاش أي تأثير على تحديث حالة طلب
--    قائم؛ هي بتأثر بس على `rpc_driver_get_available_orders` و
--    `rpc_driver_claim_order`).
--
--    الطيار الفردي: القاعدة زي ما هي (قرار مقصود من 067)، بس الرد بقى
--    فيه `provider_kind` و`active_orders` عشان الموبايل يعرض رسالة عربية
--    مفهومة بدل ما يطبع كود الإيرور.
--
-- 2) `rpc_office_assign_courier` كانت بترجع `order_not_found` لكل حاجة:
--    الطلب مش موجود، الطلب مش بتاع المكتب ده، أو الطلب اتقفل خلاص
--    (delivered/cancelled). الموزّع كان بيشوف رسالة واحدة غامضة لثلاث
--    حالات مختلفة تماماً. دلوقتي بقى فيه `order_not_assignable` منفصلة
--    ومعاها الحالة الفعلية.
--
-- كله `create or replace` — مفيش أي تغيير في السكيما، وآمن إعادة تطبيقه.
-- ============================================================


-- ── 1) إيقاف/تفعيل الاستقبال ─────────────────────────────────
create or replace function public.rpc_driver_set_availability(p_is_available boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_kind   text;
  v_active integer;
begin
  if v_uid is null or not public.is_driver() then
    return jsonb_build_object('error', 'not_a_driver');
  end if;

  select kind into v_kind from delivery_providers where id = v_uid;
  v_kind := coalesce(v_kind, 'individual');

  select count(*) into v_active from orders
  where driver_id = v_uid
    and status in ('preparing', 'ready_for_pickup', 'out_for_delivery');

  -- المكتب موزّع مش طيار: المفروض يكون ماسك طلبات على طول، فالحارس ده
  -- كان بيخلي «إيقاف الاستقبال» غير قابلة للوصول عنده أبداً.
  if p_is_available = false and v_kind <> 'office' and v_active > 0 then
    return jsonb_build_object(
      'error',         'has_active_orders',
      'active_orders', v_active,
      'provider_kind', v_kind
    );
  end if;

  update public.profiles
     set is_available = p_is_available,
         updated_at   = now()
   where id = v_uid;

  return jsonb_build_object(
    'is_available',  p_is_available,
    'active_orders', v_active,
    'provider_kind', v_kind
  );
end; $$;

revoke execute on function public.rpc_driver_set_availability(boolean) from anon, public;
grant  execute on function public.rpc_driver_set_availability(boolean) to authenticated;


-- ── 2) إسناد الطلب لطيار المكتب ──────────────────────────────
create or replace function public.rpc_office_assign_courier(
  p_order_id   uuid,
  p_courier_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_driver uuid;
begin
  if v_uid is null or not exists(
    select 1 from delivery_providers where id = v_uid and kind = 'office'
  ) then
    return jsonb_build_object('error', 'not_an_office');
  end if;

  -- إلغاء الإسناد تصحيح عادي (اتدوس على طيار غلط)، فـ null مسموحة.
  if p_courier_id is not null and not exists(
    select 1 from office_couriers
    where id = p_courier_id and office_id = v_uid and is_active
  ) then
    return jsonb_build_object('error', 'courier_not_found');
  end if;

  select o.status::text, o.driver_id
    into v_status, v_driver
  from orders o where o.id = p_order_id;

  if v_status is null or v_driver is distinct from v_uid then
    return jsonb_build_object('error', 'order_not_found');
  end if;

  -- الطلب المقفول (delivered/cancelled) مش بيتعاد إسناده — ده سجل
  -- محاسبي بيتبني عليه التحصيل.
  if v_status not in ('preparing', 'ready_for_pickup', 'out_for_delivery') then
    return jsonb_build_object('error', 'order_not_assignable', 'status', v_status);
  end if;

  update orders set
    courier_id  = p_courier_id,
    assigned_at = case when p_courier_id is null then null else now() end,
    updated_at  = now()
  where id = p_order_id
    and driver_id = v_uid;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'orders', p_order_id::text,
    jsonb_build_object('action', 'assign_courier', 'courier_id', p_courier_id));

  return public.driver_order_json(p_order_id);
end; $$;

revoke execute on function public.rpc_office_assign_courier(uuid, uuid) from anon, public;
grant  execute on function public.rpc_office_assign_courier(uuid, uuid) to authenticated;
