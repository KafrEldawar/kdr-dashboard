-- ============================================================
-- 012: Admin RPC Functions (IsSuperUser / is_admin() only)
-- ============================================================

-- ── rpc_admin_get_stats ───────────────────────────────────────
create or replace function public.rpc_admin_get_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  return jsonb_build_object(
    'restaurants',        (select count(*) from restaurants where is_active = true),
    'restaurant_owners',  (select count(*) from restaurant_owners),
    'users',              (select count(*) from profiles where role = 'customer'),
    'categories',         (select count(*) from categories where is_active = true),
    'offers',             (select count(*) from offers where is_active = true),
    'vouchers',           (select count(*) from vouchers where is_active = true),
    'orders_total',       (select count(*) from orders),
    'orders_today',       (select count(*) from orders where created_at::date = current_date),
    'orders_pending',     (select count(*) from orders where status = 'pending'),
    'revenue_today',      (select coalesce(sum(total_amount), 0) from orders
                           where created_at::date = current_date and status <> 'cancelled'),
    'ratings_total',      (select count(*) from orders where restaurant_rating is not null)
  );
end; $$;

-- ── rpc_admin_list_users ──────────────────────────────────────
create or replace function public.rpc_admin_list_users(
  p_role      text    default null,
  p_search    text    default null,
  p_page      integer default 1,
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
    select p.id, p.full_name, p.phone, p.gender, p.role, p.avatar_url, p.is_active, p.created_at,
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

-- ── rpc_admin_update_user ─────────────────────────────────────
create or replace function public.rpc_admin_update_user(
  p_user_id  uuid,
  p_role     text    default null,
  p_is_active boolean default null,
  p_full_name text   default null,
  p_phone     text   default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  update profiles set
    role      = case when p_role      is not null then p_role::user_role      else role      end,
    is_active = case when p_is_active is not null then p_is_active            else is_active end,
    full_name = coalesce(p_full_name, full_name),
    phone     = coalesce(p_phone,     phone),
    updated_at = now()
  where id = p_user_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'update', 'profiles', p_user_id::text,
    jsonb_build_object('role', p_role, 'is_active', p_is_active));

  return (select to_jsonb(p) from profiles p where p.id = p_user_id);
end; $$;

-- ── rpc_admin_create_restaurant ───────────────────────────────
create or replace function public.rpc_admin_create_restaurant(
  p_name_ar           text,
  p_name_en           text,
  p_description_ar    text  default null,
  p_description_en    text  default null,
  p_logo_url          text  default null,
  p_cover_url         text  default null,
  p_delivery_fee      numeric default 15.00,
  p_min_order_amount  numeric default 0,
  p_accepts_online    boolean default false,
  p_category_ids      uuid[]  default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_rest_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  insert into restaurants (
    name_ar, name_en, description_ar, description_en,
    logo_url, cover_url, delivery_fee, min_order_amount,
    accepts_online_orders, is_active
  ) values (
    p_name_ar, p_name_en, p_description_ar, p_description_en,
    p_logo_url, p_cover_url, p_delivery_fee, p_min_order_amount,
    p_accepts_online, true
  ) returning id into v_rest_id;

  -- Link categories
  if p_category_ids is not null then
    insert into restaurant_categories (restaurant_id, category_id)
    select v_rest_id, unnest(p_category_ids)
    on conflict do nothing;
  end if;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'restaurants', v_rest_id::text,
    jsonb_build_object('name_ar', p_name_ar, 'name_en', p_name_en));

  return public.rpc_get_restaurant_detail(v_rest_id);
end; $$;

-- ── rpc_admin_create_restaurant_owner ────────────────────────
-- Creates a new auth user + profile with role=restaurant, then links to restaurant
create or replace function public.rpc_admin_create_restaurant_owner(
  p_email         text,
  p_password      text,
  p_full_name     text,
  p_phone         text     default null,
  p_restaurant_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  -- Validate restaurant exists
  if not exists (select 1 from restaurants where id = p_restaurant_id) then
    return jsonb_build_object('error', 'Restaurant not found');
  end if;

  -- Check restaurant already has an owner
  if exists (select 1 from restaurant_owners where restaurant_id = p_restaurant_id) then
    return jsonb_build_object('error', 'Restaurant already has an owner');
  end if;

  -- Note: actual user creation must be done via Supabase Admin API (supabase.auth.admin.createUser)
  -- from an Edge Function or server-side call with service_role key.
  -- This RPC is the "link existing user to restaurant" half.
  return jsonb_build_object(
    'error', 'Use the admin-create-owner Edge Function to create the user account, then call rpc_admin_link_owner_to_restaurant'
  );
end; $$;

-- ── rpc_admin_link_owner_to_restaurant ────────────────────────
create or replace function public.rpc_admin_link_owner_to_restaurant(
  p_user_id       uuid,
  p_restaurant_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    return jsonb_build_object('error', 'User not found');
  end if;

  if not exists (select 1 from restaurants where id = p_restaurant_id) then
    return jsonb_build_object('error', 'Restaurant not found');
  end if;

  if exists (select 1 from restaurant_owners where restaurant_id = p_restaurant_id) then
    return jsonb_build_object('error', 'Restaurant already has an owner');
  end if;

  -- Update role to restaurant
  update profiles set role = 'restaurant', updated_at = now() where id = p_user_id;

  insert into restaurant_owners (user_id, restaurant_id) values (p_user_id, p_restaurant_id);

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'create', 'restaurant_owners', p_user_id::text,
    jsonb_build_object('restaurant_id', p_restaurant_id));

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'restaurant_id', p_restaurant_id);
end; $$;

-- ── rpc_admin_list_orders ─────────────────────────────────────
create or replace function public.rpc_admin_list_orders(
  p_status        text    default null,
  p_restaurant_id uuid    default null,
  p_user_id       uuid    default null,
  p_page          integer default 1,
  p_page_size     integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from orders o
  where (p_status        is null or o.status::text = p_status)
    and (p_restaurant_id is null or o.restaurant_id = p_restaurant_id)
    and (p_user_id       is null or o.user_id       = p_user_id);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select o.id, o.status, o.total_amount, o.created_at,
      jsonb_build_object('id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en) as restaurant,
      jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) as customer
    from orders o
      join restaurants r on r.id = o.restaurant_id
      join profiles    p on p.id = o.user_id
    where (p_status        is null or o.status::text = p_status)
      and (p_restaurant_id is null or o.restaurant_id = p_restaurant_id)
      and (p_user_id       is null or o.user_id       = p_user_id)
    order by o.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── rpc_admin_get_ratings ─────────────────────────────────────
create or replace function public.rpc_admin_get_ratings(
  p_restaurant_id uuid    default null,
  p_rating        integer default null,
  p_page          integer default 1,
  p_page_size     integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from orders o
  where o.restaurant_rating is not null
    and (p_restaurant_id is null or o.restaurant_id = p_restaurant_id)
    and (p_rating        is null or o.restaurant_rating = p_rating);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select o.id as order_id, o.restaurant_id, r.name_ar as restaurant_name,
      o.user_id, p.full_name as user_name,
      o.restaurant_rating as rating,
      o.restaurant_review as review,
      o.rated_at as created_at
    from orders o
      join restaurants r on r.id = o.restaurant_id
      join profiles    p on p.id = o.user_id
    where o.restaurant_rating is not null
      and (p_restaurant_id is null or o.restaurant_id = p_restaurant_id)
      and (p_rating        is null or o.restaurant_rating = p_rating)
    order by o.rated_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── rpc_admin_list_audit_logs ─────────────────────────────────
create or replace function public.rpc_admin_list_audit_logs(
  p_table_name text    default null,
  p_action     text    default null,
  p_user_id    uuid    default null,
  p_page       integer default 1,
  p_page_size  integer default 50
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from audit_logs l
  where (p_table_name is null or l.table_name = p_table_name)
    and (p_action     is null or l.action::text = p_action)
    and (p_user_id    is null or l.user_id = p_user_id);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select l.id, l.user_id, p.full_name as user_name, l.action, l.table_name,
      l.record_id, l.old_data, l.new_data, l.created_at
    from audit_logs l left join profiles p on p.id = l.user_id
    where (p_table_name is null or l.table_name = p_table_name)
      and (p_action     is null or l.action::text = p_action)
      and (p_user_id    is null or l.user_id = p_user_id)
    order by l.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── rpc_admin_manage_category ─────────────────────────────────
create or replace function public.rpc_admin_manage_category(
  p_action     text,  -- 'create' | 'update' | 'delete'
  p_id         uuid   default null,
  p_name_ar    text   default null,
  p_name_en    text   default null,
  p_image_url  text   default null,
  p_sort_order integer default null,
  p_is_active  boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  case p_action
    when 'create' then
      insert into categories (name_ar, name_en, image_url, sort_order, is_active)
      values (p_name_ar, p_name_en, p_image_url, coalesce(p_sort_order, 0), coalesce(p_is_active, true))
      returning id into v_id;
    when 'update' then
      update categories set
        name_ar    = coalesce(p_name_ar,    name_ar),
        name_en    = coalesce(p_name_en,    name_en),
        image_url  = coalesce(p_image_url,  image_url),
        sort_order = coalesce(p_sort_order, sort_order),
        is_active  = coalesce(p_is_active,  is_active),
        updated_at = now()
      where id = p_id;
      v_id := p_id;
    when 'delete' then
      delete from categories where id = p_id;
      return jsonb_build_object('success', true);
    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, p_action::audit_action, 'categories', v_id::text);

  return (select to_jsonb(c) from categories c where c.id = v_id);
end; $$;
