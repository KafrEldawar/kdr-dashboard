-- ============================================================
-- 059: Split menu-item categories from restaurant categories
--
-- Before this migration, one global `categories` table served BOTH
-- purposes:
--
--   • restaurant tags   (via `restaurant_categories` M2M) — used
--     for the customer home grid category chips and filtering.
--   • menu categories   (via `menu_items.category_id` FK) — used
--     to group items inside a restaurant's menu. Owner "custom
--     category" strings from migration 057 were also promoted
--     here.
--
-- That coupling made it impossible for admins to run distinct
-- taxonomies: whatever they added on /categories (or a menu
-- category promoted from an owner) would appear in the other
-- context too. The product decision is to keep them separate.
--
-- What changes:
--
--   • New table `menu_categories` (global, admin-managed) — same
--     shape as `categories`. This is now the source of truth for
--     menu grouping.
--   • `menu_items.category_id` FK is repointed to `menu_categories`.
--     Currently-referenced categories are copied over preserving
--     ids so no menu item loses its grouping.
--   • The owner-typed custom category promotion (`_find_or_create_*`)
--     now targets `menu_categories`. The 057 approval + owner
--     upsert paths are rebuilt to match, along with the customer
--     RPCs that inline category names next to menu items.
--   • Dormant per-restaurant `restaurant_menu_categories` table +
--     its owner RPCs are dropped — they were never wired to any
--     client and would just confuse the mental model going forward.
--
-- Idempotent + additive-first: the migration copies data, adds
-- new objects, then swaps constraints, then drops the dormant
-- ones. Safe to re-apply.
-- ============================================================


-- ── 1) Menu categories table ──────────────────────────────────
create table if not exists public.menu_categories (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text        not null,
  name_en     text        not null,
  image_url   text,
  is_active   boolean     not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_menu_categories_sort
  on public.menu_categories (sort_order, name_ar);

alter table public.menu_categories enable row level security;

-- Public read + admin write, mirroring what `categories` had.
drop policy if exists menu_categories_read   on public.menu_categories;
drop policy if exists menu_categories_admin  on public.menu_categories;

create policy menu_categories_read on public.menu_categories
  for select using (true);
create policy menu_categories_admin on public.menu_categories
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.menu_categories to anon, authenticated;

-- Case-insensitive uniqueness on the Arabic name — matches the
-- find-or-create helper below and prevents duplicate promotions
-- from separate owners typing the same category.
create unique index if not exists uq_menu_categories_name_ar_ci
  on public.menu_categories (lower(btrim(name_ar)));


-- ── 2) Seed from currently-referenced menu-item categories ────
-- Copy id-preservingly so existing menu_items.category_id values
-- stay valid after the FK swap below. We ONLY copy the categories
-- actually referenced by a menu item; restaurant-tag-only categories
-- stay in `categories` and don't leak into the menu list.
insert into public.menu_categories (id, name_ar, name_en, image_url, is_active, sort_order, created_at, updated_at)
select distinct c.id, c.name_ar, c.name_en, c.image_url, c.is_active, c.sort_order, c.created_at, c.updated_at
from   public.categories c
where  exists (select 1 from public.menu_items mi where mi.category_id = c.id)
on conflict (id) do nothing;


-- ── 3) Repoint menu_items.category_id FK ──────────────────────
alter table public.menu_items
  drop constraint if exists menu_items_category_id_fkey;

alter table public.menu_items
  add constraint menu_items_category_id_fkey
  foreign key (category_id)
  references public.menu_categories(id)
  on delete set null;


-- ── 4) Drop dormant per-restaurant menu-category scaffolding ──
-- The `restaurant_menu_categories` table + `menu_items.restaurant_category_id`
-- column + `rpc_owner_get_menu_categories` / `rpc_owner_manage_menu_category`
-- were an earlier per-restaurant design that never shipped — no client
-- calls them, and the row count is 0. Removing them keeps the schema
-- honest about which table backs the menu grouping.
drop function if exists public.rpc_owner_get_menu_categories();
drop function if exists public.rpc_owner_manage_menu_category(text, uuid, text, text, integer, boolean);

alter table public.menu_items
  drop column if exists restaurant_category_id;

drop table if exists public.restaurant_menu_categories;


-- ── 5) Find-or-create helper, now targeting menu_categories ──
-- Same contract as the 057 helper, but writes into the new table
-- and preserves the case-insensitive uniqueness invariant on
-- name_ar. Internal helper only — kept off the PostgREST surface
-- so no anon/authenticated caller can mint category rows directly.
drop function if exists public._find_or_create_category(text, text);

create or replace function public._find_or_create_menu_category(
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
  from menu_categories
  where lower(btrim(name_ar)) = lower(v_name_ar)
  order by is_active desc, created_at asc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into menu_categories (name_ar, name_en, is_active, sort_order)
  values (
    v_name_ar,
    coalesce(v_name_en, v_name_ar),
    true,
    coalesce((select max(sort_order) + 1 from menu_categories), 0)
  )
  returning id into v_id;

  return v_id;
end; $$;

revoke execute on function public._find_or_create_menu_category(text, text)
  from public, anon, authenticated;


-- ── 6) Owner upsert now reads/writes menu_categories ──────────
-- Same signature/behavior as the 057 version, only the category
-- table + helper name change. `category_name` in the response now
-- reflects the menu categories list.
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
    v_category_id := public._find_or_create_menu_category(
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
      name_ar        = coalesce(p_item->>'name_ar',                name_ar),
      name_en        = coalesce(p_item->>'name_en',                name_en),
      description_ar = coalesce(p_item->>'description',            description_ar),
      description_en = coalesce(p_item->>'description',            description_en),
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
      'category_name', (select name_ar from menu_categories where id = mi.category_id),
      'is_available',  mi.is_available,
      'badge_type',    mi.badge_type,
      'badge_label_ar',mi.badge_label_ar,
      'pending_request_id', null::uuid
    )
    from menu_items mi where mi.id = v_item_id
  );
end; $$;


-- ── 7) Admin review path uses the new helper + table ──────────
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
    v_category_id := nullif(v_req.proposed_data->>'category_id', '')::uuid;
    if v_category_id is null then
      v_category_id := public._find_or_create_menu_category(
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


-- ── 8) Customer-facing menu-category reader ───────────────────
-- Small companion to `rpc_get_categories` for menu categories.
-- Both the owner picker (new mobile build) and the customer app's
-- menu-category chip strip can use this.
create or replace function public.rpc_get_menu_categories()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en,
       'image_url', c.image_url, 'sort_order', c.sort_order,
       'item_count', (select count(*) from menu_items mi where mi.category_id = c.id)
     ) order by c.sort_order, c.name_en)
     from menu_categories c where c.is_active = true),
    '[]'::jsonb
  );
end; $$;


-- ── 9) Admin CRUD on menu categories ──────────────────────────
-- Direct mirror of `rpc_admin_manage_category` but scoped to the
-- new table. Two RPCs makes the dashboard code + audit_logs
-- unambiguous about which taxonomy is being edited.
create or replace function public.rpc_admin_manage_menu_category(
  p_action     text,
  p_id         uuid    default null,
  p_name_ar    text    default null,
  p_name_en    text    default null,
  p_image_url  text    default null,
  p_sort_order integer default null,
  p_is_active  boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  case p_action
    when 'create' then
      insert into menu_categories (name_ar, name_en, image_url, sort_order, is_active)
      values (p_name_ar, p_name_en, p_image_url, coalesce(p_sort_order, 0), coalesce(p_is_active, true))
      returning id into v_id;
    when 'update' then
      update menu_categories set
        name_ar    = coalesce(p_name_ar,    name_ar),
        name_en    = coalesce(p_name_en,    name_en),
        image_url  = coalesce(p_image_url,  image_url),
        sort_order = coalesce(p_sort_order, sort_order),
        is_active  = coalesce(p_is_active,  is_active),
        updated_at = now()
      where id = p_id;
      v_id := p_id;
    when 'delete' then
      delete from menu_categories where id = p_id;
      insert into audit_logs (user_id, action, table_name, record_id)
      values (v_uid, p_action::audit_action, 'menu_categories', p_id::text);
      return jsonb_build_object('success', true);
    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, p_action::audit_action, 'menu_categories', v_id::text);

  return (select to_jsonb(c) from menu_categories c where c.id = v_id);
end; $$;


-- ── 10) Owner list also joins the new table for category names
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
        'category_name',      (select name_ar from menu_categories where id = mi.category_id),
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


-- ── 11) Customer RPCs: menu category names from menu_categories
-- Only the menu-section sub-selects change; restaurant-level
-- `categories` (used for tag chips + filtering) is untouched.
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
    'delivery_fee', r.delivery_fee, 'min_order_amount', r.min_order_amount,
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
         'badge_type', mi.badge_type,
         'badge_label_ar', mi.badge_label_ar,
         'category_id',mi.category_id,
         'category_name_ar',(select mc.name_ar from menu_categories mc where mc.id = mi.category_id),
         'category_name_en',(select mc.name_en from menu_categories mc where mc.id = mi.category_id)
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
      (select mc.name_ar from menu_categories mc where mc.id = mi.category_id) as category_name_ar,
      (select mc.name_en from menu_categories mc where mc.id = mi.category_id) as category_name_en
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
