-- ─────────────────────────────────────────────────────────────────
-- 042_menu_category_image_url.sql
--
-- Adds `category_image_url` to each menu item entry returned by
-- `rpc_get_restaurant_detail`. The mobile app's menu tab renders the
-- category image next to the section header / chip, and currently the
-- RPC only exposes `category_name_*` — the image_url was joined for the
-- `categories` block but never for individual menu items, so the model's
-- `categoryImageUrl` field always parsed as empty.
--
-- Pure RPC patch: no table changes, no RLS changes, safe to re-run.
-- ─────────────────────────────────────────────────────────────────

create or replace function public.rpc_get_restaurant_detail(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r jsonb;
begin
  select jsonb_build_object(
    'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
    'logo_url', r.logo_url, 'cover_url', r.cover_url,
    'description_ar', r.description_ar, 'description_en', r.description_en,
    'accepts_online_orders', r.accepts_online_orders,
    'is_accepting_orders', r.is_accepting_orders,
    'estimated_delivery_time', r.estimated_delivery_time,
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
         'category_id',mi.category_id,
         'category_name_ar',(select c.name_ar from categories c where c.id = mi.category_id),
         'category_name_en',(select c.name_en from categories c where c.id = mi.category_id),
         'category_image_url',(select c.image_url from categories c where c.id = mi.category_id)
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
  where r.id = p_restaurant_id and r.is_active = true;

  return coalesce(v_r, jsonb_build_object('error', 'Restaurant not found'));
end; $$;
