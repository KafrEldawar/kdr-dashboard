-- ============================================================
-- 079 — إحداثيات الفرع في `rpc_get_restaurant_detail`
--
-- بانر «التوصيل غير متاح من هذا الفرع» كان بيظهر على **كل** الفروع،
-- حتى اللي عندها إحداثيات صحيحة في الداتابيز.
--
-- السبب: البانر بيتقرر في التطبيق من `BranchDetailModel.hasPin`، وهي
-- بتقرا `lat`/`lng` من الـ JSON اللي `rpc_get_restaurant_detail`
-- بترجّعه — والدالة دي كانت **مش** بتبعت العمودين أصلاً في مصفوفة
-- `branches` (بتبعت id + الأسماء + العناوين + location_url + التليفونات
-- وبس). فـ `lat` و`lng` كانوا دايماً null على الكلاينت → `hasPin`
-- دايماً false → البانر دايماً ظاهر.
--
-- وده بيفسّر التناقض اللي كان مربك: السيرفر بيحسب رسوم التوصيل صح
-- (`compute_delivery_fee` بتقرا `branches` من الجدول مباشرة، فشايفة
-- الإحداثيات عادي) بينما التطبيق بيقول «غير متاح» — الاتنين كانوا
-- بيشوفوا داتا مختلفة لنفس الفرع.
--
-- التغيير الوحيد هنا: زيادة `'lat',b.lat,'lng',b.lng` في بلوك
-- `branches`. باقي الدالة منقولة كما هي من النسخة اللايف.
--
-- ملاحظة: `hasPin` في التطبيق بتفحص null بس، بالظبط زي شرط السيرفر في
-- `compute_delivery_fee` و`rpc_checkout` — عشان البانر ما يختلفش تاني
-- مع اللي الشيك آوت هيقرره فعلياً.
-- ============================================================

create or replace function public.rpc_get_restaurant_detail(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_r         jsonb;
  v_show_test boolean := public.is_tester();
begin
  select jsonb_build_object(
    'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
    'logo_url', r.logo_url, 'cover_url', r.cover_url,
    'description_ar', r.description_ar, 'description_en', r.description_en,
    'accepts_online_orders', r.accepts_online_orders,
    'is_accepting_orders', r.is_accepting_orders,
    'estimated_delivery_time', r.estimated_delivery_time,
    'delivery_fee', 0, 'min_order_amount', 0,
    'created_at', r.created_at, 'updated_at', r.updated_at,
    'average_rating', coalesce(round(
      (select avg(o.restaurant_rating) from orders o
       where o.restaurant_id = r.id and o.restaurant_rating is not null)::numeric, 1), 0),
    'ratings_count', (select count(*) from orders o where o.restaurant_id = r.id and o.restaurant_rating is not null),
    'categories', coalesce(
      (select jsonb_agg(jsonb_build_object('id',c.id,'name_ar',c.name_ar,'name_en',c.name_en,'image_url',c.image_url))
       from restaurant_categories rc join categories c on c.id = rc.category_id
       where rc.restaurant_id = r.id), '[]'::jsonb),
    'branches', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id',b.id,'name_ar',b.name_ar,'name_en',b.name_en,
         'address_ar',b.address_ar,'address_en',b.address_en,'location_url',b.location_url,
         -- ↓ الإضافة الوحيدة في 079
         'lat',b.lat,'lng',b.lng,
         'phones', coalesce(
           (select jsonb_agg(bp.phone) from branch_phones bp where bp.branch_id = b.id), '[]'::jsonb)
       )) from branches b where b.restaurant_id = r.id), '[]'::jsonb),
    'gallery', coalesce(
      (select jsonb_agg(jsonb_build_object('id',g.id,'image_url',g.image_url,'description',g.description) order by g.sort_order)
       from restaurant_gallery g where g.restaurant_id = r.id), '[]'::jsonb),
    'menu', case when r.accepts_online_orders then coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id',mi.id,'name_ar',mi.name_ar,'name_en',mi.name_en,'price',mi.price,
         'description_ar',mi.description_ar,'description_en',mi.description_en,
         'image_url',mi.image_url,'is_available',mi.is_available,'sort_order',mi.sort_order,
         'badge_type', mi.badge_type, 'badge_label_ar', mi.badge_label_ar,
         'category_id',mi.category_id,
         'category_name_ar',(select mc.name_ar from menu_categories mc where mc.id = mi.category_id),
         'category_name_en',(select mc.name_en from menu_categories mc where mc.id = mi.category_id),
         'category_image_url',(select coalesce(mc.image_url, '') from menu_categories mc where mc.id = mi.category_id),
         'variants', coalesce(
           (select jsonb_agg(jsonb_build_object(
              'id', v.id, 'name_ar', v.name_ar, 'name_en', v.name_en,
              'price', v.price, 'is_default', v.is_default)
              order by v.sort_order, v.price)
            from menu_item_variants v
            where v.menu_item_id = mi.id and v.is_available), '[]'::jsonb),
         'addon_groups', coalesce(
           (select jsonb_agg(jsonb_build_object(
              'id', g.id, 'name_ar', g.name_ar, 'name_en', g.name_en,
              'min_select', g.min_select, 'max_select', g.max_select,
              'addons', coalesce(
                (select jsonb_agg(jsonb_build_object(
                   'id', a.id, 'name_ar', a.name_ar, 'name_en', a.name_en,
                   'price_delta', a.price_delta)
                   order by a.sort_order, a.name_ar)
                 from menu_addons a
                 where a.group_id = g.id and a.is_available), '[]'::jsonb))
              order by miag.sort_order, g.sort_order)
            from menu_item_addon_groups miag
            join menu_addon_groups g on g.id = miag.group_id
            where miag.menu_item_id = mi.id and g.is_active), '[]'::jsonb)
       ) order by mi.sort_order, mi.created_at)
       from menu_items mi where mi.restaurant_id = r.id and mi.is_available = true),
      '[]'::jsonb) else '[]'::jsonb end,
    'reviews', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'rating',o.restaurant_rating,'review',o.restaurant_review,
         'created_at',o.rated_at,
         'user_name',(select p.full_name from profiles p where p.id = o.user_id)
       ) order by o.rated_at desc)
       from orders o where o.restaurant_id = r.id and o.restaurant_rating is not null),
      '[]'::jsonb)
  ) into v_r
  from restaurants r
  where r.id = p_restaurant_id
    and r.is_active = true
    and (v_show_test or r.is_test = false);

  return coalesce(v_r, jsonb_build_object('error', 'Restaurant not found'));
end; $function$;
