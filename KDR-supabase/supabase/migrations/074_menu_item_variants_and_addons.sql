-- ============================================================
-- 074: Menu item variants + add-ons
--
-- Until now a menu item carried exactly ONE price. That works for
-- a donut, but not for the menus we are onboarding:
--
--   • Pub's Pizza  — every pizza has M / L / Family, and each of
--     those again in a cheese-stuffed crust (6 prices per pizza),
--     plus a half-&-half board priced per half / per quarter.
--   • Za Burger    — every burger and chicken sandwich is priced
--     سنجل / دبل, and the menu ships an "الأضافات" list.
--   • OH Donuts    — croissants, brownies, cheesecake, and the
--     whole coffee board are priced S / D (or S / F).
--
-- Modelling those as one flat item per price point would have
-- produced ~120 rows for Pub's alone and made the menu unusable.
--
-- What this migration adds:
--
--   • `menu_item_variants` — the priced choices of an item. Every
--     item that has variants has exactly one `is_default`, and the
--     item's own `menu_items.price` is kept in sync with it by a
--     trigger. That sync is what keeps every existing surface
--     (menu list, home cards, old app builds) correct without
--     knowing variants exist.
--   • `menu_addon_groups` / `menu_addons` / `menu_item_addon_groups`
--     — a per-restaurant add-on catalogue, attached to items by
--     group so "الأضافات" is authored once and reused.
--   • `cart_items` gains `variant_id` + `addon_ids`, and the
--     `unique (cart_id, menu_item_id)` constraint is replaced.
--     That constraint is the one genuinely breaking change: with
--     it in place, adding "مارجريتا وسط" then "مارجريتا لارج"
--     merged into a single row via the `on conflict` in 072.
--   • `order_items` gains structured variant/add-on columns.
--
-- ── Backward compatibility ──────────────────────────────────
-- Deliberately additive. Every new column is nullable or
-- defaulted, no column or table is dropped, and no RPC signature
-- changes shape: `rpc_add_to_cart` gains two trailing parameters
-- with defaults, so builds already on the stores keep calling the
-- 3-argument form and transparently get the default variant.
--
-- `order_items.price` still means "unit price actually charged"
-- (variant price + add-ons), so every existing revenue, commission
-- and settlement query keeps returning the same numbers.
--
-- The five functions that render order lines (`owner_order_json`,
-- `driver_order_json`, `rpc_get_order_detail`, `rpc_get_my_orders`,
-- `rpc_admin_get_order_detail`) are intentionally NOT rewritten
-- here. Checkout snapshots the variant-qualified name into
-- `order_items.item_name_ar/en` ("بيتزا مارجريتا — لارج"), so the
-- kitchen ticket, the driver sheet and the admin detail are all
-- correct on day one while the structured columns sit underneath
-- for reporting.
--
-- Idempotent: safe to re-apply.
-- ============================================================


-- ── 1) Variants ───────────────────────────────────────────────
create table if not exists public.menu_item_variants (
  id            uuid primary key default gen_random_uuid(),
  menu_item_id  uuid           not null references public.menu_items(id) on delete cascade,
  name_ar       text           not null,
  name_en       text           not null,
  price         numeric(10,2)  not null check (price >= 0),
  is_default    boolean        not null default false,
  is_available  boolean        not null default true,
  sort_order    integer        not null default 0,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now()
);

create index if not exists idx_menu_item_variants_item
  on public.menu_item_variants (menu_item_id, sort_order);

-- At most one default per item. Partial unique index rather than a
-- check constraint so the "no variants at all" case stays legal —
-- a plain item (a donut) simply has zero rows here.
create unique index if not exists uq_menu_item_variants_one_default
  on public.menu_item_variants (menu_item_id) where is_default;

-- Re-seeding the same menu must not mint duplicate sizes.
create unique index if not exists uq_menu_item_variants_name
  on public.menu_item_variants (menu_item_id, lower(btrim(name_ar)));

alter table public.menu_item_variants enable row level security;

drop policy if exists menu_item_variants_read  on public.menu_item_variants;
drop policy if exists menu_item_variants_admin on public.menu_item_variants;
drop policy if exists menu_item_variants_owner on public.menu_item_variants;

-- Mirrors the `menu_items` policy trio: public reads available rows,
-- admins manage everything, an owner manages their own restaurant.
create policy menu_item_variants_read on public.menu_item_variants
  for select using (
    is_available = true
    or public.is_admin()
    or exists (
      select 1 from public.menu_items mi
      where mi.id = menu_item_id and mi.restaurant_id = public.get_my_restaurant_id()
    )
  );

create policy menu_item_variants_admin on public.menu_item_variants
  for all using (public.is_admin()) with check (public.is_admin());

create policy menu_item_variants_owner on public.menu_item_variants
  for all
  using (exists (
    select 1 from public.menu_items mi
    where mi.id = menu_item_id and mi.restaurant_id = public.get_my_restaurant_id()))
  with check (exists (
    select 1 from public.menu_items mi
    where mi.id = menu_item_id and mi.restaurant_id = public.get_my_restaurant_id()));

grant select on public.menu_item_variants to anon, authenticated;


-- ── 2) Add-on catalogue ───────────────────────────────────────
create table if not exists public.menu_addon_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
  name_ar       text        not null,
  name_en       text        not null,
  -- min_select > 0 makes the group required (none of the three menus
  -- needs that yet, but the pizza "choose a crust" pattern will).
  min_select    integer     not null default 0 check (min_select >= 0),
  max_select    integer              check (max_select is null or max_select >= min_select),
  is_active     boolean     not null default true,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uq_menu_addon_groups_name
  on public.menu_addon_groups (restaurant_id, lower(btrim(name_ar)));

create table if not exists public.menu_addons (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid           not null references public.menu_addon_groups(id) on delete cascade,
  name_ar      text           not null,
  name_en      text           not null,
  price_delta  numeric(10,2)  not null default 0 check (price_delta >= 0),
  is_available boolean        not null default true,
  sort_order   integer        not null default 0,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now()
);

create unique index if not exists uq_menu_addons_name
  on public.menu_addons (group_id, lower(btrim(name_ar)));

create index if not exists idx_menu_addons_group
  on public.menu_addons (group_id, sort_order);

create table if not exists public.menu_item_addon_groups (
  menu_item_id uuid    not null references public.menu_items(id)        on delete cascade,
  group_id     uuid    not null references public.menu_addon_groups(id) on delete cascade,
  sort_order   integer not null default 0,
  primary key (menu_item_id, group_id)
);

alter table public.menu_addon_groups      enable row level security;
alter table public.menu_addons            enable row level security;
alter table public.menu_item_addon_groups enable row level security;

drop policy if exists menu_addon_groups_read  on public.menu_addon_groups;
drop policy if exists menu_addon_groups_write on public.menu_addon_groups;
drop policy if exists menu_addons_read        on public.menu_addons;
drop policy if exists menu_addons_write       on public.menu_addons;
drop policy if exists menu_item_addon_groups_read  on public.menu_item_addon_groups;
drop policy if exists menu_item_addon_groups_write on public.menu_item_addon_groups;

create policy menu_addon_groups_read on public.menu_addon_groups
  for select using (true);
create policy menu_addon_groups_write on public.menu_addon_groups
  for all
  using (public.is_admin() or restaurant_id = public.get_my_restaurant_id())
  with check (public.is_admin() or restaurant_id = public.get_my_restaurant_id());

create policy menu_addons_read on public.menu_addons
  for select using (true);
create policy menu_addons_write on public.menu_addons
  for all
  using (exists (
    select 1 from public.menu_addon_groups g
    where g.id = group_id
      and (public.is_admin() or g.restaurant_id = public.get_my_restaurant_id())))
  with check (exists (
    select 1 from public.menu_addon_groups g
    where g.id = group_id
      and (public.is_admin() or g.restaurant_id = public.get_my_restaurant_id())));

create policy menu_item_addon_groups_read on public.menu_item_addon_groups
  for select using (true);
create policy menu_item_addon_groups_write on public.menu_item_addon_groups
  for all
  using (exists (
    select 1 from public.menu_items mi
    where mi.id = menu_item_id
      and (public.is_admin() or mi.restaurant_id = public.get_my_restaurant_id())))
  with check (exists (
    select 1 from public.menu_items mi
    where mi.id = menu_item_id
      and (public.is_admin() or mi.restaurant_id = public.get_my_restaurant_id())));

grant select on public.menu_addon_groups, public.menu_addons, public.menu_item_addon_groups
  to anon, authenticated;


-- ── 3) Keep menu_items.price === default variant price ────────
-- This is what makes the whole migration invisible to older
-- clients: they read `menu_items.price` and get the price of the
-- variant a variant-unaware checkout would have charged them.
create or replace function public._sync_menu_item_default_price()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item_id uuid;
  v_price   numeric(10,2);
begin
  -- NEW is unassigned in an AFTER DELETE row trigger, so pick the
  -- record by TG_OP rather than coalescing across both.
  if tg_op = 'DELETE' then
    v_item_id := old.menu_item_id;
  else
    v_item_id := new.menu_item_id;
  end if;

  select price into v_price
  from menu_item_variants
  where menu_item_id = v_item_id and is_default
  limit 1;

  -- No default flagged (or the last variant was just deleted): fall
  -- back to the cheapest remaining variant so the card never shows a
  -- stale price. With zero variants left, leave the item price alone.
  if v_price is null then
    select price into v_price
    from menu_item_variants
    where menu_item_id = v_item_id and is_available
    order by price asc
    limit 1;
  end if;

  if v_price is not null then
    update menu_items set price = v_price, updated_at = now()
    where id = v_item_id and price is distinct from v_price;
  end if;

  return null;
end; $$;

drop trigger if exists trg_sync_menu_item_default_price on public.menu_item_variants;
create trigger trg_sync_menu_item_default_price
  after insert or update of price, is_default, is_available or delete
  on public.menu_item_variants
  for each row execute function public._sync_menu_item_default_price();


-- ── 4) Cart line identity ─────────────────────────────────────
alter table public.cart_items
  add column if not exists variant_id uuid references public.menu_item_variants(id) on delete cascade;

alter table public.cart_items
  add column if not exists addon_ids uuid[] not null default '{}'::uuid[];

-- The old constraint keyed a cart line by (cart, item) alone, so two
-- different sizes of the same pizza collided on the `on conflict`
-- in rpc_add_to_cart and silently merged into one line.
alter table public.cart_items drop constraint if exists unique_cart_menu_item;

-- `addon_ids` is stored pre-sorted by the RPC below so that the same
-- set of extras always produces the same key regardless of the order
-- the user tapped them in.
create unique index if not exists uq_cart_items_line
  on public.cart_items (
    cart_id,
    menu_item_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    addon_ids
  );


-- ── 5) Order line snapshot ────────────────────────────────────
-- `price` keeps its existing meaning (unit price charged, add-ons
-- included) so no downstream money query changes. `base_price` is
-- the variant price before add-ons, for reporting.
alter table public.order_items
  add column if not exists variant_id      uuid,
  add column if not exists variant_name_ar text,
  add column if not exists variant_name_en text,
  add column if not exists base_price      numeric(10,2),
  add column if not exists addons          jsonb not null default '[]'::jsonb;


-- ── 6) Pricing helper ─────────────────────────────────────────
-- Single source of truth for "what does this line cost per unit".
-- Used by the cart response, by checkout, and by anything later.
create or replace function public._menu_line_price(
  p_menu_item_id uuid,
  p_variant_id   uuid   default null,
  p_addon_ids    uuid[] default '{}'::uuid[]
)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
           (select v.price from menu_item_variants v
            where v.id = p_variant_id and v.menu_item_id = p_menu_item_id),
           (select mi.price from menu_items mi where mi.id = p_menu_item_id),
           0
         )
       + coalesce(
           (select sum(a.price_delta) from menu_addons a
            where a.id = any(coalesce(p_addon_ids, '{}'::uuid[]))),
           0
         );
$$;

-- Add-on rows as jsonb, for the cart response and the order snapshot.
create or replace function public._addons_json(p_addon_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id', a.id, 'name_ar', a.name_ar, 'name_en', a.name_en,
       'price_delta', a.price_delta) order by a.sort_order, a.name_ar)
     from menu_addons a
     where a.id = any(coalesce(p_addon_ids, '{}'::uuid[]))),
    '[]'::jsonb);
$$;

revoke execute on function public._menu_line_price(uuid, uuid, uuid[]) from anon, authenticated, public;
revoke execute on function public._addons_json(uuid[])                 from anon, authenticated, public;


-- ── 7) Cart response, now variant-aware ───────────────────────
-- Same envelope as the 055 version — `items[]`, `item_total`,
-- `total_price` — with `variant` and `addons` added per line and
-- `unit_price` made explicit. `menu_item.price` still carries the
-- item's default price so an older client reading that key is
-- unaffected.
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
         'variant_id', ci.variant_id,
         'variant', case when v.id is null then null else jsonb_build_object(
            'id', v.id, 'name_ar', v.name_ar, 'name_en', v.name_en,
            'price', v.price, 'is_available', v.is_available) end,
         'addon_ids', to_jsonb(ci.addon_ids),
         'addons', public._addons_json(ci.addon_ids),
         'unit_price', public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids),
         'menu_item', jsonb_build_object(
           'id', mi.id, 'name_ar', mi.name_ar, 'name_en', mi.name_en,
           'price', mi.price, 'image_url', mi.image_url,
           'restaurant_id', mi.restaurant_id,
           'restaurant_name_ar', r.name_ar,
           'restaurant_name_en', r.name_en,
           'restaurant_accepts_online_orders', r.accepts_online_orders,
           'restaurant_is_accepting_orders', r.is_accepting_orders,
           'is_available', mi.is_available
         ),
         'item_total', ci.quantity * public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids)
       ))
       from cart_items ci
       join menu_items mi on mi.id = ci.menu_item_id
       join restaurants r on r.id = mi.restaurant_id
       left join menu_item_variants v on v.id = ci.variant_id
       where ci.cart_id = p_cart_id),
      '[]'::jsonb
    ),
    'total_price', coalesce(
      (select sum(ci.quantity * public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids))
       from cart_items ci
       where ci.cart_id = p_cart_id), 0)
  );
end; $$;

revoke execute on function public._build_cart_response(uuid, uuid) from anon, authenticated, public;


-- ── 8) rpc_add_to_cart v3 ─────────────────────────────────────
-- Adds `p_variant_id` and `p_addon_ids` as TRAILING parameters with
-- defaults. Builds already on the stores call the 3-argument form,
-- land in the `p_variant_id is null` branch, and get the item's
-- default variant — the same thing they would have been charged
-- before this migration existed.
--
-- The old 3-argument function MUST be dropped rather than left in
-- place: `create or replace` with a different arity creates a second
-- overload, and a 3-argument call would then match both and fail with
-- "function is not unique". That is the exact dual-overload breakage
-- migration 055 caused on rpc_checkout in production.
drop function if exists public.rpc_add_to_cart(uuid, integer, text);

create or replace function public.rpc_add_to_cart(
  p_menu_item_id          uuid,
  p_quantity              integer default 1,
  p_special_instructions  text    default null,
  p_variant_id            uuid    default null,
  p_addon_ids             uuid[]  default '{}'::uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid            uuid := auth.uid();
  v_cart_id        uuid;
  v_mi             record;
  v_rest           record;
  v_first_rest_id  uuid;
  v_variant_id     uuid := p_variant_id;
  v_variant        record;
  v_addons         uuid[];
  v_has_variants   boolean;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select * into v_mi from menu_items where id = p_menu_item_id and is_available = true;
  if not found then
    return jsonb_build_object('error', 'Menu item not found or unavailable');
  end if;

  select accepts_online_orders,
         is_accepting_orders,
         coalesce(is_test, false) as is_test
  into v_rest from restaurants where id = v_mi.restaurant_id;

  -- Platform-wide pause outranks whatever the restaurant chose. Same
  -- exemptions as the orders trigger so ops can still verify.
  if public.is_online_ordering_paused()
     and not public.is_admin()
     and not coalesce(v_rest.is_test, false) then
    return jsonb_build_object(
      'error', 'ordering_paused',
      'reason_ar', (select value->>'paused_reason_ar'
                    from app_settings where key = 'ordering_status')
    );
  end if;

  if not coalesce(v_rest.accepts_online_orders, false)
     or not coalesce(v_rest.is_accepting_orders, false) then
    return jsonb_build_object('error', 'not_accepting_orders');
  end if;

  if p_quantity < 1 then
    return jsonb_build_object('error', 'Quantity must be at least 1');
  end if;

  -- ── Resolve the variant ───────────────────────────────────
  select exists (select 1 from menu_item_variants where menu_item_id = p_menu_item_id)
  into v_has_variants;

  if v_variant_id is not null then
    select * into v_variant
    from menu_item_variants
    where id = v_variant_id and menu_item_id = p_menu_item_id;

    if not found then
      return jsonb_build_object('error', 'Invalid variant for this item');
    end if;
    if not v_variant.is_available then
      return jsonb_build_object('error', 'variant_unavailable');
    end if;

  elsif v_has_variants then
    -- Old client, or a caller that just did not pick: fall back to the
    -- default so the 3-argument contract keeps working.
    select * into v_variant
    from menu_item_variants
    where menu_item_id = p_menu_item_id and is_default and is_available
    limit 1;

    if not found then
      select * into v_variant
      from menu_item_variants
      where menu_item_id = p_menu_item_id and is_available
      order by price asc
      limit 1;
    end if;

    if not found then
      return jsonb_build_object('error', 'variant_unavailable');
    end if;

    v_variant_id := v_variant.id;
  end if;

  -- ── Validate + normalise add-ons ──────────────────────────
  -- Sorted + de-duplicated so the same set always hashes to the same
  -- cart line, and restricted to groups actually attached to the item.
  select coalesce(array_agg(distinct a.id order by a.id), '{}'::uuid[])
  into v_addons
  from menu_addons a
  join menu_item_addon_groups miag on miag.group_id = a.group_id
  where a.id = any(coalesce(p_addon_ids, '{}'::uuid[]))
    and miag.menu_item_id = p_menu_item_id
    and a.is_available;

  if coalesce(array_length(p_addon_ids, 1), 0) <> coalesce(array_length(v_addons, 1), 0) then
    return jsonb_build_object('error', 'invalid_addons');
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

  insert into cart_items (cart_id, menu_item_id, quantity, special_instructions, variant_id, addon_ids)
  values (v_cart_id, p_menu_item_id, p_quantity, p_special_instructions, v_variant_id, v_addons)
  on conflict (cart_id, menu_item_id,
               coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
               addon_ids)
  do update
    set quantity = cart_items.quantity + excluded.quantity,
        special_instructions = coalesce(excluded.special_instructions, cart_items.special_instructions);

  return public._build_cart_response(v_cart_id, v_uid);
end; $$;


-- ── 9) rpc_update_cart_item — allow switching the variant ─────
-- Trailing optional params again, so the existing 3-argument call
-- from shipped builds is untouched. Old overload dropped for the same
-- ambiguity reason as rpc_add_to_cart above.
drop function if exists public.rpc_update_cart_item(uuid, integer, text);

create or replace function public.rpc_update_cart_item(
  p_cart_item_id         uuid,
  p_quantity             integer,
  p_special_instructions text   default null,
  p_variant_id           uuid   default null,
  p_addon_ids            uuid[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_cart_id  uuid;
  v_line     record;
  v_addons   uuid[];
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select id into v_cart_id from carts where user_id = v_uid;

  if p_quantity < 1 then
    delete from cart_items where id = p_cart_item_id and cart_id = v_cart_id;
    return public._build_cart_response(v_cart_id, v_uid);
  end if;

  select * into v_line from cart_items where id = p_cart_item_id and cart_id = v_cart_id;
  if not found then
    return jsonb_build_object('error', 'Cart item not found');
  end if;

  if p_variant_id is not null
     and not exists (select 1 from menu_item_variants
                     where id = p_variant_id
                       and menu_item_id = v_line.menu_item_id
                       and is_available) then
    return jsonb_build_object('error', 'Invalid variant for this item');
  end if;

  if p_addon_ids is null then
    v_addons := v_line.addon_ids;
  else
    select coalesce(array_agg(distinct a.id order by a.id), '{}'::uuid[])
    into v_addons
    from menu_addons a
    join menu_item_addon_groups miag on miag.group_id = a.group_id
    where a.id = any(p_addon_ids)
      and miag.menu_item_id = v_line.menu_item_id
      and a.is_available;

    if coalesce(array_length(p_addon_ids, 1), 0) <> coalesce(array_length(v_addons, 1), 0) then
      return jsonb_build_object('error', 'invalid_addons');
    end if;
  end if;

  -- Editing a line into the shape of another existing line would trip
  -- uq_cart_items_line; merge into that line instead of failing.
  if exists (
    select 1 from cart_items ci
    where ci.cart_id = v_cart_id
      and ci.id <> p_cart_item_id
      and ci.menu_item_id = v_line.menu_item_id
      and coalesce(ci.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(coalesce(p_variant_id, v_line.variant_id), '00000000-0000-0000-0000-000000000000'::uuid)
      and ci.addon_ids = v_addons
  ) then
    update cart_items ci
    set quantity = ci.quantity + p_quantity
    where ci.cart_id = v_cart_id
      and ci.id <> p_cart_item_id
      and ci.menu_item_id = v_line.menu_item_id
      and coalesce(ci.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(coalesce(p_variant_id, v_line.variant_id), '00000000-0000-0000-0000-000000000000'::uuid)
      and ci.addon_ids = v_addons;

    delete from cart_items where id = p_cart_item_id and cart_id = v_cart_id;
  else
    update cart_items set
      quantity             = p_quantity,
      special_instructions = coalesce(p_special_instructions, special_instructions),
      variant_id           = coalesce(p_variant_id, variant_id),
      addon_ids            = v_addons
    where id = p_cart_item_id and cart_id = v_cart_id;
  end if;

  return public._build_cart_response(v_cart_id, v_uid);
end; $$;


-- ── 10) Menu payload carries variants + add-on groups ─────────
-- Rebuilt from the live definition. Only the `menu` key changes:
-- each item gains `variants[]` and `addon_groups[]`. `price` is
-- untouched, so a client that ignores the new keys behaves exactly
-- as it does today.
create or replace function public.rpc_get_restaurant_detail(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end; $$;


-- ── 11) Checkout prices the line, not the item ────────────────
-- Rebuilt from the LIVE definition (which carries the 053 commission
-- split and the 055 busy check — the repo copy at 047 is older).
-- Three things change, all inside the two money statements:
--
--   • the subtotal sums `_menu_line_price(...)` instead of `mi.price`
--   • order_items snapshots variant + add-ons
--   • `item_name_ar/en` is snapshotted variant-qualified, which is
--     what makes the kitchen ticket, driver sheet and admin detail
--     read correctly without rewriting those five renderers.
create or replace function public.rpc_checkout(
  p_delivery_address_id uuid    default null,
  p_branch_id           uuid    default null,
  p_contact_phone       text    default null,
  p_notes               text    default null,
  p_voucher_code        text    default null,
  p_order_type          text    default 'delivery',
  p_delivery_address    text    default null,   -- legacy fallback
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

  -- Free-form alt: trim, null out empty strings, accept as-is (047 rule).
  v_alt_phone := nullif(trim(coalesce(p_alternate_phone, '')), '');

  select id into v_cart_id from carts where user_id = v_uid;
  if v_cart_id is null or not exists (select 1 from cart_items where cart_id = v_cart_id) then
    return jsonb_build_object('error', 'Cart is empty');
  end if;

  -- Variant- and add-on-aware subtotal.
  select mi.restaurant_id,
         sum(ci.quantity * public._menu_line_price(ci.menu_item_id, ci.variant_id, ci.addon_ids))
  into v_rest_id, v_subtotal
  from cart_items ci join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = v_cart_id
  group by mi.restaurant_id;

  -- Busy/offline restaurants cannot receive orders. Checked before any
  -- side effect (voucher counter, order insert) so a rejection is clean.
  select accepts_online_orders, is_accepting_orders
  into v_rest from restaurants where id = v_rest_id;
  if not coalesce(v_rest.accepts_online_orders, false)
     or not coalesce(v_rest.is_accepting_orders, false) then
    return jsonb_build_object('error', 'not_accepting_orders');
  end if;

  -- A variant that went unavailable while the cart sat open must not
  -- silently reprice to the item default at checkout.
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

    if v_branch_lat is not null and v_branch_lng is not null
       and v_addr_id is not null and v_addr_lat is not null and v_addr_lng is not null then
      select * into v_fee_row from compute_delivery_fee(v_branch_id, v_addr_id);
      if v_fee_row.needs_pin then
        return jsonb_build_object('error', 'address_needs_pin');
      end if;
      if not v_fee_row.in_range then
        return jsonb_build_object('error', 'address_out_of_range');
      end if;
      v_delivery_fee := v_fee_row.fee;
      v_distance_km  := v_fee_row.distance_km;
    else
      return jsonb_build_object('error', 'address_needs_pin');
    end if;
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
    -- Never let a voucher discount exceed the food value.
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


-- ── 12) Grants ────────────────────────────────────────────────
grant execute on function public.rpc_add_to_cart(uuid, integer, text, uuid, uuid[])          to authenticated;
grant execute on function public.rpc_update_cart_item(uuid, integer, text, uuid, uuid[])     to authenticated;
grant execute on function public.rpc_get_restaurant_detail(uuid)                             to anon, authenticated;
grant execute on function public.rpc_checkout(uuid, uuid, text, text, text, text, text, text) to authenticated;
