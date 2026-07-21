-- ============================================================
-- 057: Menu item badges + owner custom-category promotion
--
--  A) Badges
--     Each menu item can carry ONE badge shown on its card
--     (mobile customer + owner list + dashboard). Two columns:
--       • badge_type      — a key from a curated set the clients
--                           style (best_seller | special_offer |
--                           new | recommended) OR 'custom'.
--       • badge_label_ar  — free text used only when badge_type =
--                           'custom' (curated types derive their
--                           label client-side, so styling/labels
--                           can change with no migration).
--     No DB CHECK: the mobile picker and dashboard Select only ever
--     emit known values, and the renderers fall back gracefully.
--
--  B) Owner custom category → global category
--     When an owner adds an item they either pick an existing
--     (admin-managed) global category via `category_id`, OR type a
--     brand-new category name. The typed name travels in the change
--     request's `proposed_data` as `custom_category_ar` /
--     `custom_category_en`. On approval we resolve it to a real
--     `categories` row (find-or-create, case-insensitive on name_ar)
--     so it joins the shared admin list and becomes reusable — per
--     the product decision "custom category becomes a general one".
--
--  All changes are additive: new nullable columns + extra JSON keys
--  in existing RPC payloads. Old app builds ignore the new keys, so
--  this is safe to ship ahead of the new mobile release. Idempotent.
-- ============================================================

-- ── A) Schema ──────────────────────────────────────────────────
alter table public.menu_items
  add column if not exists badge_type     text,
  add column if not exists badge_label_ar text;

comment on column public.menu_items.badge_type is
  'Optional single badge key: best_seller | special_offer | new | recommended | custom. Clients style it.';
comment on column public.menu_items.badge_label_ar is
  'Free-text badge label, used only when badge_type = ''custom''.';


-- ── B) Helper: find-or-create a global category by Arabic name ──
-- Internal only (not granted to API roles); called from the
-- SECURITY DEFINER RPCs below, so it runs with their privileges.
-- Returns NULL for a blank name. Matches case-insensitively on
-- name_ar to avoid spawning duplicates when several owners type
-- the same category.
create or replace function public._find_or_create_category(
  p_name_ar text,
  p_name_en text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_name_ar text := nullif(btrim(p_name_ar), '');
  v_name_en text := nullif(btrim(coalesce(p_name_en, p_name_ar)), '');
begin
  if v_name_ar is null then
    return null;
  end if;

  select id into v_id
  from categories
  where lower(btrim(name_ar)) = lower(v_name_ar)
  order by is_active desc, created_at asc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into categories (name_ar, name_en, is_active, sort_order)
  values (
    v_name_ar,
    coalesce(v_name_en, v_name_ar),
    true,
    coalesce((select max(sort_order) + 1 from categories), 0)
  )
  returning id into v_id;

  return v_id;
end; $$;

-- Internal helper only: keep it off the PostgREST surface so no
-- anon/authenticated caller can mint category rows directly. The
-- SECURITY DEFINER RPCs below are owned by `postgres` and call it as
-- the owner, so revoking the default PUBLIC grant doesn't break them.
revoke execute on function public._find_or_create_category(text, text)
  from public, anon, authenticated;


-- ── B) Approval: resolve custom category + apply badges ────────
-- Rebuilt from the live body; only the category resolution and the
-- badge columns are new. Badge writes use has-key semantics so an
-- explicit clear (key present, value null/'') removes the badge,
-- while an absent key leaves it untouched.
create or replace function public.rpc_admin_review_menu_item_request(
  p_request_id uuid,
  p_status     text,
  p_admin_note text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_req         menu_item_change_requests%rowtype;
  v_item_id     uuid;
  v_category_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Admin access required');
  end if;

  if p_status not in ('approved', 'rejected') then
    return jsonb_build_object('error', 'Status must be approved or rejected');
  end if;

  select * into v_req from menu_item_change_requests where id = p_request_id;
  if not found then
    return jsonb_build_object('error', 'Request not found');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('error', 'Request is already ' || v_req.status);
  end if;

  update menu_item_change_requests set
    status      = p_status,
    admin_note  = p_admin_note,
    reviewed_by = v_uid,
    reviewed_at = now()
  where id = p_request_id;

  if p_status = 'approved' then
    -- Explicit category wins; otherwise promote the typed custom name
    -- into the shared `categories` list (find-or-create).
    v_category_id := nullif(v_req.proposed_data->>'category_id', '')::uuid;
    if v_category_id is null then
      v_category_id := public._find_or_create_category(
        v_req.proposed_data->>'custom_category_ar',
        v_req.proposed_data->>'custom_category_en'
      );
    end if;

    if v_req.action = 'create' then
      insert into menu_items (
        restaurant_id, name_ar, name_en,
        description_ar, description_en,
        price, image_url, category_id, is_available, sort_order,
        badge_type, badge_label_ar
      ) values (
        v_req.restaurant_id,
        coalesce(v_req.proposed_data->>'name_ar', ''),
        coalesce(v_req.proposed_data->>'name_en', ''),
        v_req.proposed_data->>'description',
        v_req.proposed_data->>'description',
        coalesce((v_req.proposed_data->>'price')::numeric, 0),
        v_req.proposed_data->>'image_url',
        v_category_id,
        coalesce((v_req.proposed_data->>'is_available')::boolean, true),
        0,
        nullif(v_req.proposed_data->>'badge_type', ''),
        nullif(v_req.proposed_data->>'badge_label_ar', '')
      ) returning id into v_item_id;
      update menu_item_change_requests set menu_item_id = v_item_id where id = p_request_id;

    elsif v_req.action = 'update' and v_req.menu_item_id is not null then
      update menu_items set
        name_ar        = coalesce(v_req.proposed_data->>'name_ar',        name_ar),
        name_en        = coalesce(v_req.proposed_data->>'name_en',        name_en),
        description_ar = coalesce(v_req.proposed_data->>'description',    description_ar),
        description_en = coalesce(v_req.proposed_data->>'description',    description_en),
        price          = coalesce((v_req.proposed_data->>'price')::numeric, price),
        image_url      = coalesce(v_req.proposed_data->>'image_url',      image_url),
        category_id    = coalesce(v_category_id, category_id),
        is_available   = coalesce((v_req.proposed_data->>'is_available')::boolean, is_available),
        badge_type     = case when v_req.proposed_data ? 'badge_type'
                              then nullif(v_req.proposed_data->>'badge_type', '')
                              else badge_type end,
        badge_label_ar = case when v_req.proposed_data ? 'badge_type'
                              then nullif(v_req.proposed_data->>'badge_label_ar', '')
                              else badge_label_ar end,
        updated_at     = now()
      where id = v_req.menu_item_id;
    end if;

    insert into audit_logs (user_id, action, table_name, record_id)
    values (v_uid, 'update', 'menu_items', coalesce(v_item_id, v_req.menu_item_id)::text);
  end if;

  return jsonb_build_object('success', true, 'status', p_status);
end; $$;


-- ── B/A) Direct owner upsert: same custom-category + badge logic ─
-- Kept in parity with the approval path. Additive: applies category
-- resolution + badges and returns the badge fields.
create or replace function public.rpc_owner_upsert_menu_item(p_item jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_rest_id     uuid := public.get_my_restaurant_id();
  v_item_id     uuid := (p_item->>'id')::uuid;
  v_category_id uuid;
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  v_category_id := nullif(p_item->>'category_id', '')::uuid;
  if v_category_id is null then
    v_category_id := public._find_or_create_category(
      p_item->>'custom_category_ar',
      p_item->>'custom_category_en'
    );
  end if;

  if v_item_id is not null then
    if not exists (
      select 1 from menu_items where id = v_item_id and restaurant_id = v_rest_id
    ) then
      return jsonb_build_object('error', 'Menu item not found or access denied');
    end if;
    update menu_items set
      name_ar        = coalesce(p_item->>'name_ar',               name_ar),
      name_en        = coalesce(p_item->>'name_en',               name_en),
      description_ar = coalesce(p_item->>'description',           description_ar),
      description_en = coalesce(p_item->>'description',           description_en),
      price          = coalesce((p_item->>'price')::numeric,       price),
      image_url      = coalesce(p_item->>'image_url',              image_url),
      category_id    = coalesce(v_category_id,                     category_id),
      is_available   = coalesce((p_item->>'is_available')::boolean, is_available),
      badge_type     = case when p_item ? 'badge_type'
                            then nullif(p_item->>'badge_type', '')
                            else badge_type end,
      badge_label_ar = case when p_item ? 'badge_type'
                            then nullif(p_item->>'badge_label_ar', '')
                            else badge_label_ar end,
      updated_at     = now()
    where id = v_item_id;
    insert into audit_logs (user_id, action, table_name, record_id)
    values (v_uid, 'update', 'menu_items', v_item_id::text);
  else
    insert into menu_items (
      restaurant_id, name_ar, name_en,
      description_ar, description_en,
      price, image_url, category_id, is_available, sort_order,
      badge_type, badge_label_ar
    ) values (
      v_rest_id,
      coalesce(p_item->>'name_ar', ''),
      coalesce(p_item->>'name_en', ''),
      p_item->>'description',
      p_item->>'description',
      coalesce((p_item->>'price')::numeric, 0),
      p_item->>'image_url',
      v_category_id,
      coalesce((p_item->>'is_available')::boolean, true),
      0,
      nullif(p_item->>'badge_type', ''),
      nullif(p_item->>'badge_label_ar', '')
    ) returning id into v_item_id;
    insert into audit_logs (user_id, action, table_name, record_id)
    values (v_uid, 'create', 'menu_items', v_item_id::text);
  end if;

  return (
    select jsonb_build_object(
      'id',            mi.id,
      'name_ar',       mi.name_ar,
      'name_en',       coalesce(mi.name_en, ''),
      'description',   coalesce(mi.description_ar, mi.description_en),
      'price',         mi.price,
      'image_url',     mi.image_url,
      'category_id',   mi.category_id,
      'category_name', (select name_ar from categories where id = mi.category_id),
      'is_available',  mi.is_available,
      'badge_type',    mi.badge_type,
      'badge_label_ar',mi.badge_label_ar,
      'pending_request_id', null::uuid
    )
    from menu_items mi where mi.id = v_item_id
  );
end; $$;


-- ── A) Owner list: expose badge fields (for display + edit preload)
create or replace function public.rpc_owner_get_menu_items()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rest_id uuid := public.get_my_restaurant_id();
begin
  if v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  return jsonb_build_object(
    'data', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',                 mi.id,
        'name_ar',            mi.name_ar,
        'name_en',            coalesce(mi.name_en, ''),
        'description',        coalesce(mi.description_ar, mi.description_en),
        'price',              mi.price,
        'image_url',          mi.image_url,
        'category_id',        mi.category_id,
        'category_name',      (select name_ar from categories where id = mi.category_id),
        'is_available',       mi.is_available,
        'badge_type',         mi.badge_type,
        'badge_label_ar',     mi.badge_label_ar,
        'pending_request_id', (
          select r.id from menu_item_change_requests r
          where r.menu_item_id = mi.id and r.status = 'pending'
          order by r.created_at desc limit 1
        )
      ) order by mi.sort_order, mi.name_ar), '[]'::jsonb)
      from menu_items mi
      where mi.restaurant_id = v_rest_id
    ),
    'pending_creates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',            r.id,
        'action',        r.action,
        'status',        r.status,
        'proposed_data', r.proposed_data,
        'owner_note',    r.owner_note,
        'created_at',    r.created_at
      ) order by r.created_at desc), '[]'::jsonb)
      from menu_item_change_requests r
      where r.restaurant_id = v_rest_id
        and r.action = 'create'
        and r.status = 'pending'
    )
  );
end; $$;


-- ── A) Customer restaurant detail: expose badge on each menu item
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
  where r.id = p_restaurant_id and r.is_active = true;

  return coalesce(v_r, jsonb_build_object('error', 'Restaurant not found'));
end; $$;


-- ── A) Customer menu listing/search: expose badge fields ───────
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
begin
  select count(*) into v_total
  from menu_items mi join restaurants r on r.id = mi.restaurant_id
  where mi.is_available = true and r.is_active = true and r.accepts_online_orders = true
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
