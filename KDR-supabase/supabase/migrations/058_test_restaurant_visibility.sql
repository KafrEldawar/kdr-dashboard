-- ============================================================
-- 058: Test-restaurant visibility (tester allowlist)
--
-- Lets us run a real, online test restaurant on the LIVE app that is
-- visible only to designated "tester" accounts (and admins), so full
-- end-to-end test cases can run in production without any normal user
-- seeing the test restaurant.
--
--   • restaurants.is_test  — flags a restaurant as test-only.
--   • profiles.is_tester   — flags an account as allowed to see them.
--   • is_tester()          — true for admins OR flagged accounts.
--
-- The three customer read paths (list / detail / menu search) hide
-- test restaurants unless the caller is a tester. Owner/driver flows
-- use their own RPCs and are unaffected. All additive + default-off →
-- zero behaviour change until a restaurant is explicitly flagged.
-- Idempotent.
-- ============================================================

alter table public.restaurants add column if not exists is_test boolean not null default false;
alter table public.profiles    add column if not exists is_tester boolean not null default false;

comment on column public.restaurants.is_test is
  'Test-only restaurant: visible to tester/admin accounts only (see is_tester()).';
comment on column public.profiles.is_tester is
  'Account may see test restaurants (restaurants.is_test) on the live app.';


-- ── is_tester(): admin OR flagged account ──────────────────────
-- Internal helper, mirrors is_admin(). Only called from the
-- SECURITY DEFINER read RPCs below (which run as their postgres owner),
-- so it is kept off the anon/authenticated API surface.
create or replace function public.is_tester()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists(
    select 1 from public.profiles
    where id = auth.uid() and is_tester = true
  );
$$;

revoke execute on function public.is_tester() from public, anon, authenticated;


-- ── rpc_get_restaurants: hide test restaurants from non-testers ─
create or replace function public.rpc_get_restaurants(
  p_page integer default 1,
  p_page_size integer default 10,
  p_search text default null,
  p_category_id uuid default null,
  p_accepts_online boolean default null,
  p_is_accepting boolean default null,
  p_pinned_ids uuid[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
  v_tester boolean := public.is_tester();
begin
  select count(*) into v_total
  from restaurants r
  where r.is_active = true
    and (v_tester or not r.is_test)
    and (p_search is null or
         to_tsvector('simple', coalesce(r.name_ar,'') || ' ' || coalesce(r.name_en,''))
         @@ plainto_tsquery('simple', p_search))
    and (p_category_id is null or exists(
           select 1 from restaurant_categories rc
           where rc.restaurant_id = r.id and rc.category_id = p_category_id))
    and (p_accepts_online is null or r.accepts_online_orders = p_accepts_online)
    and (p_is_accepting  is null or r.is_accepting_orders   = p_is_accepting);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select
      r.id, r.name_ar, r.name_en, r.logo_url, r.cover_url,
      r.accepts_online_orders, r.is_accepting_orders,
      r.estimated_delivery_time,
      r.created_at,
      coalesce(round(
        (select avg(o.restaurant_rating) from orders o
         where o.restaurant_id = r.id and o.restaurant_rating is not null)::numeric, 1), 0
      ) as average_rating,
      (select count(*) from orders o
       where o.restaurant_id = r.id and o.restaurant_rating is not null) as ratings_count,
      coalesce(
        (select jsonb_agg(jsonb_build_object('id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en))
         from restaurant_categories rc join categories c on c.id = rc.category_id
         where rc.restaurant_id = r.id), '[]'::jsonb
      ) as categories
    from restaurants r
    where r.is_active = true
      and (v_tester or not r.is_test)
      and (p_search is null or
           to_tsvector('simple', coalesce(r.name_ar,'') || ' ' || coalesce(r.name_en,''))
           @@ plainto_tsquery('simple', p_search))
      and (p_category_id is null or exists(
             select 1 from restaurant_categories rc
             where rc.restaurant_id = r.id and rc.category_id = p_category_id))
      and (p_accepts_online is null or r.accepts_online_orders = p_accepts_online)
      and (p_is_accepting  is null or r.is_accepting_orders   = p_is_accepting)
    order by
      array_position(p_pinned_ids, r.id) nulls last,
      r.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object(
      'total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)
    )
  );
end; $$;


-- ── rpc_get_restaurant_detail: block direct open of a test rest. ─
-- (Carries the 057 badge fields; adds the is_test guard to the WHERE.)
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
         'category_image_url',(select c.image_url from categories c where c.id = mi.category_id),
         'badge_type',mi.badge_type,
         'badge_label_ar',mi.badge_label_ar
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
  where r.id = p_restaurant_id and r.is_active = true
    and (public.is_tester() or not r.is_test);

  return coalesce(v_r, jsonb_build_object('error', 'Restaurant not found'));
end; $$;


-- ── rpc_get_menu_items: hide test-restaurant items from non-testers
-- (Carries the 057 badge fields; adds the is_test guard.)
create or replace function public.rpc_get_menu_items(
  p_restaurant_id uuid    default null,
  p_category_id   uuid    default null,
  p_search        text    default null,
  p_min_price     numeric default null,
  p_max_price     numeric default null,
  p_page          integer default 1,
  p_page_size     integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
  v_tester boolean := public.is_tester();
begin
  select count(*) into v_total
  from menu_items mi join restaurants r on r.id = mi.restaurant_id
  where mi.is_available = true and r.is_active = true and r.accepts_online_orders = true
    and (v_tester or not r.is_test)
    and (p_restaurant_id is null or mi.restaurant_id = p_restaurant_id)
    and (p_category_id   is null or mi.category_id   = p_category_id)
    and (p_min_price     is null or mi.price >= p_min_price)
    and (p_max_price     is null or mi.price <= p_max_price)
    and (p_search is null or to_tsvector('simple', coalesce(mi.name_ar,'') || ' ' || coalesce(mi.name_en,''))
         @@ plainto_tsquery('simple', p_search));

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select mi.id, mi.restaurant_id, mi.category_id, mi.name_ar, mi.name_en, mi.price,
      mi.description_ar, mi.description_en, mi.image_url, mi.is_available, mi.sort_order,
      mi.badge_type, mi.badge_label_ar,
      (select c.name_ar from categories c where c.id = mi.category_id) as category_name_ar,
      (select c.name_en from categories c where c.id = mi.category_id) as category_name_en
    from menu_items mi join restaurants r on r.id = mi.restaurant_id
    where mi.is_available = true and r.is_active = true and r.accepts_online_orders = true
      and (v_tester or not r.is_test)
      and (p_restaurant_id is null or mi.restaurant_id = p_restaurant_id)
      and (p_category_id   is null or mi.category_id   = p_category_id)
      and (p_min_price     is null or mi.price >= p_min_price)
      and (p_max_price     is null or mi.price <= p_max_price)
      and (p_search is null or to_tsvector('simple', coalesce(mi.name_ar,'') || ' ' || coalesce(mi.name_en,''))
           @@ plainto_tsquery('simple', p_search))
    order by mi.sort_order, mi.created_at
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size))
  );
end; $$;


-- ── rpc_admin_list_users: expose is_tester so the dashboard shows it
create or replace function public.rpc_admin_list_users(
  p_role text default null,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from profiles p
  where (p_role   is null or p.role::text = p_role)
    and (p_search is null or
         p.full_name ilike '%' || p_search || '%' or
         p.phone ilike '%' || p_search || '%');

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select
      p.id, p.full_name, p.phone, p.gender, p.role, p.avatar_url,
      p.is_active, p.created_at,
      p.phone_verified_at,
      coalesce(p.whatsapp_opt_in, true) as whatsapp_opt_in,
      coalesce(p.is_tester, false) as is_tester,
      (select jsonb_build_object('id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en)
       from restaurant_owners ro join restaurants r on r.id = ro.restaurant_id
       where ro.user_id = p.id) as restaurant
    from profiles p
    where (p_role   is null or p.role::text = p_role)
      and (p_search is null or
           p.full_name ilike '%' || p_search || '%' or
           p.phone ilike '%' || p_search || '%')
    order by p.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;


-- ── rpc_admin_set_tester: flip an account's tester flag ────────
create or replace function public.rpc_admin_set_tester(
  p_user_id uuid,
  p_is_tester boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Admin access required');
  end if;

  update profiles set is_tester = coalesce(p_is_tester, false), updated_at = now()
  where id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'User not found');
  end if;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'profiles', p_user_id::text);

  return jsonb_build_object('success', true, 'is_tester', coalesce(p_is_tester, false));
end; $$;
