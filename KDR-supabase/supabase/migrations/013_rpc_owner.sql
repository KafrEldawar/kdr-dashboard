-- ============================================================
-- 013: Restaurant Owner RPC Functions
-- ============================================================

-- ── rpc_owner_get_dashboard ───────────────────────────────────
create or replace function public.rpc_owner_get_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  return jsonb_build_object(
    'restaurant', (select to_jsonb(r) from restaurants r where r.id = v_rest_id),
    'stats', jsonb_build_object(
      'orders_total',    (select count(*) from orders where restaurant_id = v_rest_id),
      'orders_today',    (select count(*) from orders where restaurant_id = v_rest_id and created_at::date = current_date),
      'orders_pending',  (select count(*) from orders where restaurant_id = v_rest_id and status = 'pending'),
      'revenue_today',   (select coalesce(sum(total_amount), 0) from orders
                          where restaurant_id = v_rest_id and created_at::date = current_date and status <> 'cancelled'),
      'average_rating',  (select coalesce(round(avg(restaurant_rating)::numeric, 1), 0)
                          from orders where restaurant_id = v_rest_id and restaurant_rating is not null),
      'ratings_count',   (select count(*) from orders where restaurant_id = v_rest_id and restaurant_rating is not null),
      'menu_items',      (select count(*) from menu_items where restaurant_id = v_rest_id and is_available = true)
    ),
    'recent_orders', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', o.id, 'status', o.status, 'total_amount', o.total_amount,
         'created_at', o.created_at,
         'customer_name', (select p.full_name from profiles p where p.id = o.user_id)
       ) order by o.created_at desc)
       from orders o where o.restaurant_id = v_rest_id
       order by o.created_at desc limit 10),
      '[]'::jsonb
    )
  );
end; $$;

-- ── rpc_owner_get_orders ──────────────────────────────────────
create or replace function public.rpc_owner_get_orders(
  p_status    text    default null,
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rest_id uuid    := public.get_my_restaurant_id();
  v_offset  integer := (p_page - 1) * p_page_size;
  v_total   integer;
  v_data    jsonb;
begin
  if v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  select count(*) into v_total from orders
  where restaurant_id = v_rest_id
    and (p_status is null or status::text = p_status);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select o.id, o.status, o.total_amount, o.subtotal, o.delivery_fee, o.discount,
      o.delivery_address, o.contact_phone, o.notes, o.created_at, o.updated_at,
      jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) as customer,
      (select count(*) from order_items oi where oi.order_id = o.id) as items_count
    from orders o join profiles p on p.id = o.user_id
    where o.restaurant_id = v_rest_id
      and (p_status is null or o.status::text = p_status)
    order by o.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── rpc_owner_update_restaurant ───────────────────────────────
create or replace function public.rpc_owner_update_restaurant(
  p_name_ar               text    default null,
  p_name_en               text    default null,
  p_description_ar        text    default null,
  p_description_en        text    default null,
  p_logo_url              text    default null,
  p_cover_url             text    default null,
  p_delivery_fee          numeric default null,
  p_min_order_amount      numeric default null,
  p_estimated_delivery    integer default null,
  p_is_accepting_orders   boolean default null,
  p_accepts_online_orders boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  update restaurants set
    name_ar               = coalesce(p_name_ar,             name_ar),
    name_en               = coalesce(p_name_en,             name_en),
    description_ar        = coalesce(p_description_ar,      description_ar),
    description_en        = coalesce(p_description_en,      description_en),
    logo_url              = coalesce(p_logo_url,            logo_url),
    cover_url             = coalesce(p_cover_url,           cover_url),
    delivery_fee          = coalesce(p_delivery_fee,        delivery_fee),
    min_order_amount      = coalesce(p_min_order_amount,    min_order_amount),
    estimated_delivery_time = coalesce(p_estimated_delivery, estimated_delivery_time),
    is_accepting_orders   = coalesce(p_is_accepting_orders, is_accepting_orders),
    accepts_online_orders = coalesce(p_accepts_online_orders, accepts_online_orders),
    updated_at = now()
  where id = v_rest_id;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'restaurants', v_rest_id::text);

  return public.rpc_get_restaurant_detail(v_rest_id);
end; $$;

-- ── rpc_owner_manage_menu_item ────────────────────────────────
create or replace function public.rpc_owner_manage_menu_item(
  p_action         text,   -- 'create' | 'update' | 'delete'
  p_id             uuid    default null,
  p_name_ar        text    default null,
  p_name_en        text    default null,
  p_description_ar text    default null,
  p_description_en text    default null,
  p_price          numeric default null,
  p_image_url      text    default null,
  p_category_id    uuid    default null,
  p_sort_order     integer default null,
  p_is_available   boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_item_id uuid;
begin
  if v_uid is null or (v_rest_id is null and not public.is_admin()) then
    return jsonb_build_object('error', 'Access denied');
  end if;

  case p_action
    when 'create' then
      insert into menu_items (restaurant_id, category_id, name_ar, name_en,
        description_ar, description_en, price, image_url, sort_order, is_available)
      values (v_rest_id, p_category_id, p_name_ar, p_name_en,
        p_description_ar, p_description_en, p_price, p_image_url,
        coalesce(p_sort_order, 0), coalesce(p_is_available, true))
      returning id into v_item_id;
    when 'update' then
      -- Verify ownership
      if not exists (select 1 from menu_items where id = p_id and restaurant_id = v_rest_id)
         and not public.is_admin() then
        return jsonb_build_object('error', 'Menu item not found or access denied');
      end if;
      update menu_items set
        name_ar        = coalesce(p_name_ar,        name_ar),
        name_en        = coalesce(p_name_en,        name_en),
        description_ar = coalesce(p_description_ar, description_ar),
        description_en = coalesce(p_description_en, description_en),
        price          = coalesce(p_price,          price),
        image_url      = coalesce(p_image_url,      image_url),
        category_id    = coalesce(p_category_id,    category_id),
        sort_order     = coalesce(p_sort_order,     sort_order),
        is_available   = coalesce(p_is_available,   is_available),
        updated_at = now()
      where id = p_id;
      v_item_id := p_id;
    when 'delete' then
      if not exists (select 1 from menu_items where id = p_id and restaurant_id = v_rest_id)
         and not public.is_admin() then
        return jsonb_build_object('error', 'Menu item not found or access denied');
      end if;
      delete from menu_items where id = p_id;
      return jsonb_build_object('success', true);
    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, p_action::audit_action, 'menu_items', v_item_id::text);

  return (select to_jsonb(mi) from menu_items mi where mi.id = v_item_id);
end; $$;

-- ── rpc_owner_manage_offer ────────────────────────────────────
create or replace function public.rpc_owner_manage_offer(
  p_action              text,
  p_id                  uuid     default null,
  p_title_ar            text     default null,
  p_title_en            text     default null,
  p_description_ar      text     default null,
  p_description_en      text     default null,
  p_image_url           text     default null,
  p_discount_percentage numeric  default null,
  p_start_date          date     default null,
  p_end_date            date     default null,
  p_is_active           boolean  default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_offer_id uuid;
begin
  if v_uid is null or (v_rest_id is null and not public.is_admin()) then
    return jsonb_build_object('error', 'Access denied');
  end if;

  case p_action
    when 'create' then
      insert into offers (restaurant_id, title_ar, title_en, description_ar, description_en,
        image_url, discount_percentage, start_date, end_date, is_active)
      values (v_rest_id, p_title_ar, p_title_en, p_description_ar, p_description_en,
        p_image_url, p_discount_percentage, p_start_date, p_end_date,
        coalesce(p_is_active, true))
      returning id into v_offer_id;
    when 'update' then
      if not exists (select 1 from offers where id = p_id and restaurant_id = v_rest_id)
         and not public.is_admin() then
        return jsonb_build_object('error', 'Offer not found or access denied');
      end if;
      update offers set
        title_ar            = coalesce(p_title_ar,            title_ar),
        title_en            = coalesce(p_title_en,            title_en),
        description_ar      = coalesce(p_description_ar,      description_ar),
        description_en      = coalesce(p_description_en,      description_en),
        image_url           = coalesce(p_image_url,           image_url),
        discount_percentage = coalesce(p_discount_percentage, discount_percentage),
        start_date          = coalesce(p_start_date,          start_date),
        end_date            = coalesce(p_end_date,            end_date),
        is_active           = coalesce(p_is_active,           is_active),
        updated_at = now()
      where id = p_id;
      v_offer_id := p_id;
    when 'delete' then
      delete from offers where id = p_id and (restaurant_id = v_rest_id or public.is_admin());
      return jsonb_build_object('success', true);
    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  return (select to_jsonb(o) from offers o where o.id = v_offer_id);
end; $$;

-- ── rpc_owner_manage_voucher ──────────────────────────────────
create or replace function public.rpc_owner_manage_voucher(
  p_action           text,
  p_id               uuid     default null,
  p_code             text     default null,
  p_discount_type    text     default null,
  p_discount_value   numeric  default null,
  p_min_order_amount numeric  default null,
  p_valid_from       timestamptz default null,
  p_valid_to         timestamptz default null,
  p_usage_limit      integer  default null,
  p_is_active        boolean  default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_rest_id  uuid := public.get_my_restaurant_id();
  v_voucher_id uuid;
begin
  if v_uid is null or (v_rest_id is null and not public.is_admin()) then
    return jsonb_build_object('error', 'Access denied');
  end if;

  case p_action
    when 'create' then
      if exists (select 1 from vouchers where code = p_code and restaurant_id = v_rest_id) then
        return jsonb_build_object('error', 'Voucher code already exists for this restaurant');
      end if;
      insert into vouchers (restaurant_id, code, discount_type, discount_value,
        min_order_amount, valid_from, valid_to, usage_limit, is_active)
      values (v_rest_id, p_code, p_discount_type::discount_type_enum, p_discount_value,
        coalesce(p_min_order_amount, 0),
        coalesce(p_valid_from, now()), coalesce(p_valid_to, now() + interval '30 days'),
        p_usage_limit, coalesce(p_is_active, true))
      returning id into v_voucher_id;
    when 'update' then
      if not exists (select 1 from vouchers where id = p_id and restaurant_id = v_rest_id)
         and not public.is_admin() then
        return jsonb_build_object('error', 'Voucher not found or access denied');
      end if;
      update vouchers set
        discount_type    = case when p_discount_type    is not null then p_discount_type::discount_type_enum    else discount_type    end,
        discount_value   = coalesce(p_discount_value,   discount_value),
        min_order_amount = coalesce(p_min_order_amount, min_order_amount),
        valid_from       = coalesce(p_valid_from,       valid_from),
        valid_to         = coalesce(p_valid_to,         valid_to),
        usage_limit      = coalesce(p_usage_limit,      usage_limit),
        is_active        = coalesce(p_is_active,        is_active),
        updated_at = now()
      where id = p_id;
      v_voucher_id := p_id;
    when 'delete' then
      delete from vouchers where id = p_id and (restaurant_id = v_rest_id or public.is_admin());
      return jsonb_build_object('success', true);
    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  return (select to_jsonb(v) from vouchers v where v.id = v_voucher_id);
end; $$;

-- ── rpc_owner_manage_branch ───────────────────────────────────
create or replace function public.rpc_owner_manage_branch(
  p_action     text,
  p_id         uuid    default null,
  p_name_ar    text    default null,
  p_name_en    text    default null,
  p_address_ar text    default null,
  p_address_en text    default null,
  p_location_url text  default null,
  p_phones     text[]  default null  -- replaces all phones on update
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_rest_id   uuid := public.get_my_restaurant_id();
  v_branch_id uuid;
  v_phone     text;
begin
  if v_uid is null or (v_rest_id is null and not public.is_admin()) then
    return jsonb_build_object('error', 'Access denied');
  end if;

  case p_action
    when 'create' then
      insert into branches (restaurant_id, name_ar, name_en, address_ar, address_en, location_url)
      values (v_rest_id, p_name_ar, p_name_en, p_address_ar, p_address_en, p_location_url)
      returning id into v_branch_id;
      if p_phones is not null then
        foreach v_phone in array p_phones loop
          insert into branch_phones (branch_id, phone) values (v_branch_id, v_phone);
        end loop;
      end if;
    when 'update' then
      if not exists (select 1 from branches where id = p_id and restaurant_id = v_rest_id)
         and not public.is_admin() then
        return jsonb_build_object('error', 'Branch not found or access denied');
      end if;
      update branches set
        name_ar      = coalesce(p_name_ar,      name_ar),
        name_en      = coalesce(p_name_en,      name_en),
        address_ar   = coalesce(p_address_ar,   address_ar),
        address_en   = coalesce(p_address_en,   address_en),
        location_url = coalesce(p_location_url, location_url),
        updated_at = now()
      where id = p_id;
      if p_phones is not null then
        delete from branch_phones where branch_id = p_id;
        foreach v_phone in array p_phones loop
          insert into branch_phones (branch_id, phone) values (p_id, v_phone);
        end loop;
      end if;
      v_branch_id := p_id;
    when 'delete' then
      delete from branches where id = p_id and (restaurant_id = v_rest_id or public.is_admin());
      return jsonb_build_object('success', true);
    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  return public.rpc_get_branches(v_rest_id);
end; $$;

-- ── rpc_owner_manage_gallery ──────────────────────────────────
create or replace function public.rpc_owner_manage_gallery(
  p_action      text,
  p_id          uuid    default null,
  p_image_url   text    default null,
  p_description text    default null,
  p_sort_order  integer default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_img_id  uuid;
begin
  if v_uid is null or (v_rest_id is null and not public.is_admin()) then
    return jsonb_build_object('error', 'Access denied');
  end if;

  case p_action
    when 'create' then
      insert into restaurant_gallery (restaurant_id, image_url, description, sort_order)
      values (v_rest_id, p_image_url, p_description, coalesce(p_sort_order, 0))
      returning id into v_img_id;
    when 'update' then
      if not exists (select 1 from restaurant_gallery where id = p_id and restaurant_id = v_rest_id)
         and not public.is_admin() then
        return jsonb_build_object('error', 'Gallery item not found or access denied');
      end if;
      update restaurant_gallery set
        image_url   = coalesce(p_image_url,   image_url),
        description = coalesce(p_description, description),
        sort_order  = coalesce(p_sort_order,  sort_order)
      where id = p_id;
      v_img_id := p_id;
    when 'delete' then
      delete from restaurant_gallery where id = p_id
        and (restaurant_id = v_rest_id or public.is_admin());
      return jsonb_build_object('success', true);
    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  return (select to_jsonb(g) from restaurant_gallery g where g.id = v_img_id);
end; $$;
