-- ============================================================
-- 010: Cart RPC Functions
-- Add unique constraint first, then RPC functions
-- ============================================================

alter table public.cart_items
  add constraint unique_cart_menu_item unique (cart_id, menu_item_id);

-- ── internal: get cart rows helper ───────────────────────────
-- Not an RPC endpoint — called by other functions
create or replace function public._build_cart_response(p_cart_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'id', p_cart_id,
    'user_id', p_user_id,
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', ci.id,
         'menu_item_id', ci.menu_item_id,
         'quantity', ci.quantity,
         'special_instructions', ci.special_instructions,
         'menu_item', jsonb_build_object(
           'id', mi.id, 'name_ar', mi.name_ar, 'name_en', mi.name_en,
           'price', mi.price, 'image_url', mi.image_url,
           'restaurant_id', mi.restaurant_id,
           'restaurant_name_ar', (select r.name_ar from restaurants r where r.id = mi.restaurant_id),
           'restaurant_name_en', (select r.name_en from restaurants r where r.id = mi.restaurant_id),
           'is_available', mi.is_available
         ),
         'item_total', ci.quantity * mi.price
       ))
       from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
       where ci.cart_id = p_cart_id),
      '[]'::jsonb
    ),
    'total_price', coalesce(
      (select sum(ci.quantity * mi.price)
       from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
       where ci.cart_id = p_cart_id), 0)
  );
end; $$;

-- Revoke direct RPC access to internal helper
revoke execute on function public._build_cart_response(uuid, uuid) from anon, authenticated, public;

-- ── rpc_get_my_cart ───────────────────────────────────────────
create or replace function public.rpc_get_my_cart()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_cart_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  insert into carts (user_id) values (v_uid) on conflict (user_id) do nothing;
  select id into v_cart_id from carts where user_id = v_uid;

  return public._build_cart_response(v_cart_id, v_uid);
end; $$;

-- ── rpc_add_to_cart ───────────────────────────────────────────
create or replace function public.rpc_add_to_cart(
  p_menu_item_id          uuid,
  p_quantity              integer default 1,
  p_special_instructions  text    default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid              uuid := auth.uid();
  v_cart_id          uuid;
  v_mi               record;
  v_first_rest_id    uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select * into v_mi from menu_items where id = p_menu_item_id and is_available = true;
  if not found then
    return jsonb_build_object('error', 'Menu item not found or unavailable');
  end if;

  if p_quantity < 1 then
    return jsonb_build_object('error', 'Quantity must be at least 1');
  end if;

  insert into carts (user_id) values (v_uid) on conflict (user_id) do nothing;
  select id into v_cart_id from carts where user_id = v_uid;

  -- Enforce single-restaurant cart
  select mi.restaurant_id into v_first_rest_id
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id limit 1;

  if v_first_rest_id is not null and v_first_rest_id <> v_mi.restaurant_id then
    return jsonb_build_object(
      'error', 'You can only order from one restaurant at a time. Clear your cart first.',
      'conflicting_restaurant_id', v_first_rest_id
    );
  end if;

  insert into cart_items (cart_id, menu_item_id, quantity, special_instructions)
  values (v_cart_id, p_menu_item_id, p_quantity, p_special_instructions)
  on conflict (cart_id, menu_item_id) do update
    set quantity = cart_items.quantity + excluded.quantity,
        special_instructions = coalesce(excluded.special_instructions, cart_items.special_instructions);

  return public._build_cart_response(v_cart_id, v_uid);
end; $$;

-- ── rpc_update_cart_item ──────────────────────────────────────
create or replace function public.rpc_update_cart_item(
  p_cart_item_id         uuid,
  p_quantity             integer,
  p_special_instructions text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_cart_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select id into v_cart_id from carts where user_id = v_uid;

  if p_quantity < 1 then
    -- Delete instead
    delete from cart_items where id = p_cart_item_id and cart_id = v_cart_id;
  else
    update cart_items set
      quantity = p_quantity,
      special_instructions = coalesce(p_special_instructions, special_instructions)
    where id = p_cart_item_id and cart_id = v_cart_id;
  end if;

  return public._build_cart_response(v_cart_id, v_uid);
end; $$;

-- ── rpc_remove_cart_item ──────────────────────────────────────
create or replace function public.rpc_remove_cart_item(p_cart_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_cart_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select id into v_cart_id from carts where user_id = v_uid;
  delete from cart_items where id = p_cart_item_id and cart_id = v_cart_id;

  return public._build_cart_response(v_cart_id, v_uid);
end; $$;

-- ── rpc_clear_cart ────────────────────────────────────────────
create or replace function public.rpc_clear_cart()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_cart_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select id into v_cart_id from carts where user_id = v_uid;
  if v_cart_id is not null then
    delete from cart_items where cart_id = v_cart_id;
  end if;

  return jsonb_build_object('success', true, 'items', '[]'::jsonb, 'total_price', 0);
end; $$;
