-- ============================================================
-- 008: Core Public RPC Functions (no auth required)
-- ============================================================

-- ── rpc_get_categories ────────────────────────────────────────
create or replace function public.rpc_get_categories()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en,
       'image_url', c.image_url, 'sort_order', c.sort_order,
       'restaurant_count', (select count(*) from restaurant_categories rc where rc.category_id = c.id)
     ) order by c.sort_order, c.name_en)
     from categories c where c.is_active = true),
    '[]'::jsonb
  );
end; $$;

-- ── rpc_get_restaurants ───────────────────────────────────────
create or replace function public.rpc_get_restaurants(
  p_page          integer  default 1,
  p_page_size     integer  default 10,
  p_search        text     default null,
  p_category_id   uuid     default null,
  p_accepts_online boolean  default null,
  p_is_accepting  boolean  default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  select count(*) into v_total
  from restaurants r
  where r.is_active = true
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
      r.estimated_delivery_time, r.delivery_fee, r.min_order_amount,
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
      and (p_search is null or
           to_tsvector('simple', coalesce(r.name_ar,'') || ' ' || coalesce(r.name_en,''))
           @@ plainto_tsquery('simple', p_search))
      and (p_category_id is null or exists(
             select 1 from restaurant_categories rc
             where rc.restaurant_id = r.id and rc.category_id = p_category_id))
      and (p_accepts_online is null or r.accepts_online_orders = p_accepts_online)
      and (p_is_accepting  is null or r.is_accepting_orders   = p_is_accepting)
    order by r.created_at desc
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

-- ── rpc_get_restaurant_detail ─────────────────────────────────
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
         'category_id',mi.category_id,
         'category_name_ar',(select c.name_ar from categories c where c.id = mi.category_id),
         'category_name_en',(select c.name_en from categories c where c.id = mi.category_id)
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

-- ── rpc_get_menu_items ────────────────────────────────────────
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

-- ── rpc_get_branches ──────────────────────────────────────────
create or replace function public.rpc_get_branches(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id',b.id,'name_ar',b.name_ar,'name_en',b.name_en,
       'address_ar',b.address_ar,'address_en',b.address_en,
       'location_url',b.location_url,'created_at',b.created_at,
       'phones', coalesce(
         (select jsonb_agg(bp.phone) from branch_phones bp where bp.branch_id = b.id), '[]'::jsonb)
     ))
     from branches b where b.restaurant_id = p_restaurant_id),
    '[]'::jsonb
  );
end; $$;

-- ── rpc_get_offers ────────────────────────────────────────────
create or replace function public.rpc_get_offers(
  p_restaurant_id uuid    default null,
  p_active_only   boolean default true
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id',o.id,'restaurant_id',o.restaurant_id,'title_ar',o.title_ar,'title_en',o.title_en,
       'description_ar',o.description_ar,'description_en',o.description_en,
       'image_url',o.image_url,'discount_percentage',o.discount_percentage,
       'is_active',o.is_active,'start_date',o.start_date,'end_date',o.end_date,
       'created_at',o.created_at
     ) order by o.created_at desc)
     from offers o
     where (p_restaurant_id is null or o.restaurant_id = p_restaurant_id)
       and (not p_active_only or (o.is_active = true and (o.end_date is null or o.end_date >= current_date)))),
    '[]'::jsonb
  );
end; $$;

-- ── rpc_get_vouchers ──────────────────────────────────────────
create or replace function public.rpc_get_vouchers(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id',v.id,'code',v.code,'discount_type',v.discount_type,'discount_value',v.discount_value,
       'min_order_amount',v.min_order_amount,'valid_from',v.valid_from,'valid_to',v.valid_to,
       'is_active',v.is_active,'usage_limit',v.usage_limit,'used_count',v.used_count
     ) order by v.created_at desc)
     from vouchers v
     where v.restaurant_id = p_restaurant_id
       and v.is_active = true and v.valid_to >= now()),
    '[]'::jsonb
  );
end; $$;

-- ── rpc_validate_voucher ──────────────────────────────────────
create or replace function public.rpc_validate_voucher(
  p_code          text,
  p_restaurant_id uuid,
  p_subtotal      numeric
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_v record;
  v_discount numeric;
begin
  select * into v_v from vouchers
  where code = p_code and restaurant_id = p_restaurant_id
    and is_active = true and valid_from <= now() and valid_to >= now();

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Invalid or expired voucher code');
  end if;

  if v_v.usage_limit is not null and v_v.used_count >= v_v.usage_limit then
    return jsonb_build_object('valid', false, 'error', 'Voucher usage limit reached');
  end if;

  if p_subtotal < v_v.min_order_amount then
    return jsonb_build_object('valid', false,
      'error', format('Minimum order amount is %s', v_v.min_order_amount));
  end if;

  v_discount := case when v_v.discount_type = 'percentage'
    then (p_subtotal * v_v.discount_value) / 100
    else v_v.discount_value end;

  return jsonb_build_object(
    'valid', true, 'voucher_id', v_v.id, 'code', v_v.code,
    'discount', v_discount, 'discount_type', v_v.discount_type,
    'discount_value', v_v.discount_value
  );
end; $$;
