-- ============================================================
-- 078 — معادلة التوصيل الجديدة + توضيح سبب رفض الفرع
--
-- ── 1) المعادلة ──────────────────────────────────────────────
--
-- المطلوب: أول ٢ كيلو بـ ٢٠ جنيه ثابتة، وبعد كده كل كيلو زيادة
-- بـ ٥ جنيه بالنسبة والتناسب (٣.٤ كم = ٢٠ + ١.٤×٥ = ٢٧ جنيه).
--
-- المعادلة القديمة كانت `base + per_km × distance` من غير أي مسافة
-- مجانية، فأقرب طلب (٠.٥ كم) كان بيتحسب ١٣.٢٥ جنيه وطلب ٢ كم بـ ٢٣.
-- الحل مفتاح جديد في الكونفيج اسمه `free_km`:
--
--     billable = greatest(0, routed_km - free_km)
--     fee      = clamp(min, max, base + per_km × billable)
--
-- `free_km` لو مش موجود في الكونفيج بيتحسب صفر — يعني السلوك القديم
-- بالظبط، فالدالة آمنة حتى لو الكونفيج ما اتحدّثش.
--
-- المسافة اللي بتتحسب عليها هي **المسافة بعد `route_factor`** (نفس
-- الرقم اللي العميل بيشوفه في الفاتورة)، مش المسافة الهوائية — عشان
-- الرقم المعروض والسعر يبقوا متسقين.
--
-- الأرقام الجديدة: base=20, per_km=5, free_km=2, min=20, max=85.
-- الـ max اتحسبت عشان تطابق المعادلة بالظبط عند أقصى مسافة مسموحة
-- (١٥ كم → ٢٠ + ١٣×٥ = ٨٥)، فمفيش قصّ صامت جوه النطاق.
--
-- ── 2) الفرع اللي مالوش إحداثيات ─────────────────────────────
--
-- كان في تناقض بين دالتين: `compute_delivery_fee` كانت بترجّع
-- `in_range = true` وسعر الحد الأدنى للفرع اللي مالوش بِن، بينما
-- `rpc_checkout` بترفض نفس الطلب بـ `address_needs_pin`. النتيجة:
-- العميل بيشوف رسوم توصيل محسوبة في الشاشة، وبعدين الطلب يترفض
-- برسالة بتقوله «حدد موقعك على الخريطة» — وهو حدده بالفعل. المشكلة
-- في **الفرع** مش في عنوانه (٤١ فرع من ٤٧ لسه من غير إحداثيات).
--
-- الدالتين بقوا متسقين، ومعاهم خرج جديد `branch_needs_pin` عشان
-- الموبايل يقول السبب الصح. القرار إن الطلب يفضل مرفوض — الحل
-- الجذري إن الأدمن يضيف إحداثيات الفروع.
--
-- ملاحظة: `compute_delivery_fee` محتاجة drop قبل الـ create لأن
-- عمود جديد في `returns table` مش بيعدّي بـ `create or replace`.
-- `rpc_checkout` بتقراها في `record` فالعمود الزيادة مايكسرش حاجة،
-- والنسخ القديمة من التطبيق بتقرا بالمفتاح فبتتجاهله.
-- ============================================================


-- ── 1) الكونفيج ──────────────────────────────────────────────
update public.app_settings
   set value = value
             || jsonb_build_object(
                  'base',    20,
                  'per_km',  5,
                  'free_km', 2,
                  'min',     20,
                  'max',     85
                ),
       updated_at = now()
 where key = 'delivery_fee_config';


-- ── 2) compute_delivery_fee ──────────────────────────────────
drop function if exists public.compute_delivery_fee(uuid, uuid);

create function public.compute_delivery_fee(p_branch_id uuid, p_address_id uuid)
returns table (
  distance_km      numeric,
  fee              numeric,
  in_range         boolean,
  needs_pin        boolean,
  branch_needs_pin boolean,
  currency         text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b_lat    double precision;
  v_b_lng    double precision;
  v_a_lat    double precision;
  v_a_lng    double precision;
  v_cfg      jsonb;
  v_raw_km   numeric;
  v_dist_km  numeric;
  v_billable numeric;
  v_fee      numeric;
  v_base     numeric;
  v_per_km   numeric;
  v_free_km  numeric;
  v_min      numeric;
  v_max      numeric;
  v_factor   numeric;
  v_maxd     numeric;
  v_curr     text;
begin
  select value into v_cfg from public.app_settings where key = 'delivery_fee_config';
  if v_cfg is null then
    raise exception 'delivery_fee_config missing from app_settings';
  end if;

  v_base    := (v_cfg ->> 'base')::numeric;
  v_per_km  := (v_cfg ->> 'per_km')::numeric;
  -- Absent on configs written before this migration → 0, which reproduces
  -- the old "charge from the first metre" behaviour exactly.
  v_free_km := greatest(coalesce((v_cfg ->> 'free_km')::numeric, 0), 0);
  v_min     := (v_cfg ->> 'min')::numeric;
  v_max     := (v_cfg ->> 'max')::numeric;
  v_factor  := coalesce((v_cfg ->> 'route_factor')::numeric, 1.0);
  v_maxd    := (v_cfg ->> 'max_distance_km')::numeric;
  v_curr    := coalesce(v_cfg ->> 'currency', 'EGP');

  select b.lat, b.lng into v_b_lat, v_b_lng
  from public.branches b where b.id = p_branch_id;

  select a.lat, a.lng into v_a_lat, v_a_lng
  from public.user_addresses a where a.id = p_address_id;

  -- needs_pin is ONLY about the customer's address.
  if v_a_lat is null or v_a_lng is null then
    return query select 0::numeric, 0::numeric, false, true, false, v_curr;
    return;
  end if;

  -- A branch with no coordinates cannot be measured from, and rpc_checkout
  -- refuses the order — so quoting a fee here would be a lie the customer
  -- only discovers on the confirm button. Reported as its own reason.
  if v_b_lat is null or v_b_lng is null then
    return query select 0::numeric, 0::numeric, false, false, true, v_curr;
    return;
  end if;

  v_raw_km  := public.haversine_km(v_b_lat, v_b_lng, v_a_lat, v_a_lng);
  v_dist_km := round((v_raw_km * v_factor)::numeric, 2);

  if v_dist_km > v_maxd then
    return query select v_dist_km, 0::numeric, false, false, false, v_curr;
    return;
  end if;

  -- The first `free_km` are included in `base`; only the surplus is billed.
  v_billable := greatest(v_dist_km - v_free_km, 0);
  v_fee      := v_base + (v_per_km * v_billable);
  v_fee      := greatest(v_min, least(v_max, v_fee));
  v_fee      := round(v_fee, 2);

  return query select v_dist_km, v_fee, true, false, false, v_curr;
end;
$$;

revoke execute on function public.compute_delivery_fee(uuid, uuid) from anon;
grant  execute on function public.compute_delivery_fee(uuid, uuid) to authenticated;


-- ── 3) rpc_checkout: سبب الرفض الصح ──────────────────────────
-- نفس الدالة بالظبط، الفرق الوحيد إن الفرع اللي مالوش إحداثيات بقى
-- بيرجّع `branch_needs_pin` بدل `address_needs_pin` المضلّلة.
create or replace function public.rpc_checkout(
  p_delivery_address_id uuid    default null,
  p_branch_id           uuid    default null,
  p_contact_phone       text    default null,
  p_notes               text    default null,
  p_voucher_code        text    default null,
  p_order_type          text    default 'delivery',
  p_delivery_address    text    default null,
  p_alternate_phone     text    default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid    := auth.uid();
  v_cart_id      uuid;
  v_rest_id      uuid;
  v_rest         record;
  v_subtotal     numeric(10,2) := 0;
  v_discount     numeric(10,2) := 0;
  v_total        numeric(10,2);
  v_voucher      record;
  v_voucher_id   uuid    := null;
  v_order_id     uuid;
  v_order_type   public.order_type;
  v_comm_pct     numeric(5,2) := 0;
  v_comm_gross   numeric(10,2);
  v_comm_amount  numeric(10,2);
  v_platform_share numeric(10,2);
  v_rest_share   numeric(10,2);
  v_rest_revenue numeric(10,2);

  v_branch_id    uuid;
  v_branch_count integer;
  v_branch_lat   double precision;
  v_branch_lng   double precision;

  v_addr_id      uuid;
  v_addr_text    text;
  v_addr_lat     double precision;
  v_addr_lng     double precision;

  v_fee_row      record;
  v_delivery_fee numeric(10,2) := 0;
  v_distance_km  numeric(6,2)  := null;

  v_alt_phone    text;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  begin
    v_order_type := p_order_type::public.order_type;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid order type: ' || p_order_type);
  end;

  if p_contact_phone is null or p_contact_phone = '' then
    return jsonb_build_object('error', 'Contact phone is required');
  end if;

  v_alt_phone := nullif(trim(coalesce(p_alternate_phone, '')), '');

  select id into v_cart_id from carts where user_id = v_uid;
  if v_cart_id is null or not exists (select 1 from cart_items where cart_id = v_cart_id) then
    return jsonb_build_object('error', 'Cart is empty');
  end if;

  select mi.restaurant_id,
         sum(ci.quantity * public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids))
  into v_rest_id, v_subtotal
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id
  group by mi.restaurant_id;

  select accepts_online_orders, is_accepting_orders
  into v_rest from restaurants where id = v_rest_id;
  if not coalesce(v_rest.accepts_online_orders, false)
     or not coalesce(v_rest.is_accepting_orders, false) then
    return jsonb_build_object('error', 'not_accepting_orders');
  end if;

  if exists (
    select 1 from cart_items ci
    join menu_item_variants v on v.id = ci.variant_id
    where ci.cart_id = v_cart_id and not v.is_available
  ) then
    return jsonb_build_object('error', 'variant_unavailable');
  end if;

  -- ── Delivery-specific validation + fee computation ──────────
  if v_order_type = 'delivery' then
    if p_branch_id is not null then
      select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
      from branches where id = p_branch_id and restaurant_id = v_rest_id;
      if v_branch_id is null then
        return jsonb_build_object('error', 'Invalid branch for this restaurant');
      end if;
    else
      select count(*) into v_branch_count from branches where restaurant_id = v_rest_id;
      if v_branch_count = 1 then
        select id, lat, lng into v_branch_id, v_branch_lat, v_branch_lng
        from branches where restaurant_id = v_rest_id;
      else
        return jsonb_build_object('error', 'branch_id is required when the restaurant has multiple branches');
      end if;
    end if;

    if p_delivery_address_id is not null then
      select id, address_ar, lat, lng
      into v_addr_id, v_addr_text, v_addr_lat, v_addr_lng
      from user_addresses where id = p_delivery_address_id and user_id = v_uid;
      if v_addr_id is null then
        return jsonb_build_object('error', 'Address not found or access denied');
      end if;
    elsif p_delivery_address is not null and p_delivery_address <> '' then
      v_addr_text := p_delivery_address;
    else
      return jsonb_build_object('error', 'Delivery address is required for delivery orders');
    end if;

    -- The branch and the address are two separate reasons to refuse, and
    -- collapsing both into `address_needs_pin` sent customers off to re-pin
    -- an address that was already fine.
    if v_branch_lat is null or v_branch_lng is null then
      return jsonb_build_object('error', 'branch_needs_pin');
    end if;
    if v_addr_id is null or v_addr_lat is null or v_addr_lng is null then
      return jsonb_build_object('error', 'address_needs_pin');
    end if;

    select * into v_fee_row from compute_delivery_fee(v_branch_id, v_addr_id);
    if v_fee_row.needs_pin then
      return jsonb_build_object('error', 'address_needs_pin');
    end if;
    if v_fee_row.branch_needs_pin then
      return jsonb_build_object('error', 'branch_needs_pin');
    end if;
    if not v_fee_row.in_range then
      return jsonb_build_object('error', 'address_out_of_range');
    end if;
    v_delivery_fee := v_fee_row.fee;
    v_distance_km  := v_fee_row.distance_km;
  end if;

  -- ── Voucher ─────────────────────────────────────────────────
  if p_voucher_code is not null and p_voucher_code <> '' then
    select * into v_voucher
    from vouchers
    where code = p_voucher_code and restaurant_id = v_rest_id
      and is_active = true and valid_from <= now() and valid_to >= now();

    if not found then
      return jsonb_build_object('error', 'Invalid or expired voucher code');
    end if;
    if v_voucher.usage_limit is not null and v_voucher.used_count >= v_voucher.usage_limit then
      return jsonb_build_object('error', 'Voucher usage limit reached');
    end if;
    if v_subtotal < v_voucher.min_order_amount then
      return jsonb_build_object('error',
        format('Minimum order amount for this voucher is %s', v_voucher.min_order_amount));
    end if;

    v_voucher_id := v_voucher.id;
    v_discount := round(
      case when v_voucher.discount_type = 'percentage'
        then (v_subtotal * v_voucher.discount_value) / 100
        else v_voucher.discount_value end,
      2);
    v_discount := least(v_discount, v_subtotal);

    update vouchers set used_count = used_count + 1 where id = v_voucher_id;
  end if;

  v_total := greatest(v_subtotal - v_discount, 0) + v_delivery_fee;

  -- ── Commission split (053 formula: platform absorbs first) ──
  select commission_percentage into v_comm_pct from restaurants where id = v_rest_id;
  v_comm_pct       := coalesce(v_comm_pct, 0);
  v_comm_gross     := round(v_subtotal * v_comm_pct / 100, 2);
  v_platform_share := least(v_discount, v_comm_gross);
  v_rest_share     := greatest(v_discount - v_comm_gross, 0);
  v_comm_amount    := v_comm_gross - v_platform_share;
  v_rest_revenue   := greatest(v_subtotal - v_discount - v_comm_amount, 0);

  insert into orders (
    user_id, restaurant_id, status, order_type,
    delivery_address, contact_phone, alternate_phone, notes,
    subtotal, delivery_fee, discount, total_amount,
    commission_percentage, commission_gross, commission_amount,
    discount_platform_share, discount_restaurant_share,
    restaurant_revenue,
    voucher_id,
    branch_id, delivery_address_id,
    branch_lat, branch_lng,
    delivery_lat, delivery_lng,
    delivery_distance_km
  ) values (
    v_uid, v_rest_id, 'pending', v_order_type,
    case when v_order_type = 'delivery' then v_addr_text else null end,
    p_contact_phone, v_alt_phone, p_notes,
    v_subtotal, v_delivery_fee, v_discount, v_total,
    v_comm_pct, v_comm_gross, v_comm_amount,
    v_platform_share, v_rest_share,
    v_rest_revenue,
    v_voucher_id,
    v_branch_id, v_addr_id,
    v_branch_lat, v_branch_lng,
    v_addr_lat, v_addr_lng,
    v_distance_km
  )
  returning id into v_order_id;

  insert into order_items (
    order_id, menu_item_id, item_name_en, item_name_ar,
    price, base_price, quantity, special_instructions,
    variant_id, variant_name_ar, variant_name_en, addons
  )
  select
    v_order_id,
    ci.menu_item_id,
    mi.name_en || coalesce(' — ' || v.name_en, ''),
    mi.name_ar || coalesce(' — ' || v.name_ar, ''),
    public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids),
    coalesce(v.price, mi.price),
    ci.quantity,
    ci.special_instructions,
    ci.variant_id, v.name_ar, v.name_en,
    public._addons_json(ci.addon_ids)
  from cart_items ci
  join menu_items mi on mi.id = ci.menu_item_id
  left join menu_item_variants v on v.id = ci.variant_id
  where ci.cart_id = v_cart_id;

  delete from cart_items where cart_id = v_cart_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'orders', v_order_id::text,
    jsonb_build_object(
      'total',                     v_total,
      'restaurant_id',             v_rest_id,
      'order_type',                v_order_type,
      'branch_id',                 v_branch_id,
      'delivery_fee',              v_delivery_fee,
      'distance_km',               v_distance_km,
      'commission_gross',          v_comm_gross,
      'commission_amount',         v_comm_amount,
      'discount_platform_share',   v_platform_share,
      'discount_restaurant_share', v_rest_share
    ));

  return public.rpc_get_order_detail(v_order_id);
end; $$;

revoke execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text, text) from anon;
grant  execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text, text) to authenticated;
