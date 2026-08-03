-- ============================================================
-- 072: Platform-wide online-ordering kill switch.
--
-- Why:
--   When delivery breaks — no riders, a payment outage, a bad deploy —
--   the only way to stop the bleeding was to open every restaurant in
--   the dashboard and flip `accepts_online_orders` off one by one, then
--   remember to flip each one back. That is slow at exactly the moment
--   speed matters, and it *destroys information*: a restaurant that had
--   deliberately turned itself off is indistinguishable afterwards from
--   one we turned off, so "turn everything back on" silently reopens
--   restaurants that never wanted to be open.
--
--   So this is a separate, global flag. Per-restaurant settings are never
--   touched; the switch simply outranks them while it is engaged, and
--   flipping it back restores whatever each restaurant had chosen.
--
-- Enforcement:
--   * `rpc_add_to_cart` rejects early with the `ordering_paused` token, so
--     nobody builds a cart they will not be allowed to check out.
--   * A BEFORE INSERT trigger on `orders` is the hard stop. A kill switch
--     that relies on every present and future RPC remembering to call it
--     is not a kill switch — the trigger holds no matter which code path
--     tries to create an order. `rpc_checkout` runs in one transaction,
--     so the raise also rolls back the voucher counter it may have
--     already incremented.
--
--   Two deliberate exemptions: admins (seeding, manually recovering an
--   order taken over the phone) and restaurants flagged `is_test`, so ops
--   can place a real end-to-end order to confirm the platform is healthy
--   *before* reopening it to customers.
--
-- Fail-open:
--   A missing or malformed `ordering_status` row reads as "not paused".
--   A settings table having a bad day must not take down ordering.
-- ============================================================

-- ── 1) The setting ───────────────────────────────────────────
insert into public.app_settings (key, value)
values (
  'ordering_status',
  jsonb_build_object(
    'online_ordering_enabled', true,
    'paused_reason_ar', null,
    'paused_at', null
  )
)
on conflict (key) do nothing;

-- Guests browse without signing in, and they should see *why* the order
-- buttons are dead rather than a silently broken app. Scoped to this one
-- key so the rest of app_settings stays behind auth.
drop policy if exists "app_settings: anon read ordering status" on public.app_settings;
create policy "app_settings: anon read ordering status"
  on public.app_settings for select to anon
  using (key = 'ordering_status');


-- ── 2) Read helpers ──────────────────────────────────────────
create or replace function public.is_online_ordering_paused()
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce(
    (select (s.value->>'online_ordering_enabled')::boolean
     from public.app_settings s
     where s.key = 'ordering_status'),
    true
  );
$$;

revoke execute on function public.is_online_ordering_paused() from public;
grant  execute on function public.is_online_ordering_paused() to anon, authenticated, service_role;

-- Public read of the switch, used by the mobile app on cold start and on
-- every foreground.
create or replace function public.rpc_get_ordering_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'online_ordering_enabled',
         coalesce((s.value->>'online_ordering_enabled')::boolean, true),
       'paused_reason_ar', s.value->>'paused_reason_ar',
       'paused_at',        s.value->>'paused_at'
     )
     from public.app_settings s
     where s.key = 'ordering_status'),
    jsonb_build_object(
      'online_ordering_enabled', true,
      'paused_reason_ar', null,
      'paused_at', null
    )
  );
$$;

grant execute on function public.rpc_get_ordering_status() to anon, authenticated;


-- ── 3) Admin write ───────────────────────────────────────────
create or replace function public.rpc_admin_set_ordering_status(
  p_enabled   boolean,
  p_reason_ar text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid    := auth.uid();
  v_enabled boolean := coalesce(p_enabled, true);
  v_reason  text    := nullif(btrim(coalesce(p_reason_ar, '')), '');
  v_value   jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Not an admin');
  end if;

  v_value := jsonb_build_object(
    'online_ordering_enabled', v_enabled,
    'paused_reason_ar', case when v_enabled then null else v_reason end,
    'paused_at',        case when v_enabled then null::timestamptz else now() end
  );

  insert into public.app_settings (key, value, updated_at, updated_by)
  values ('ordering_status', v_value, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  insert into public.audit_logs (user_id, action, table_name, record_id, new_data)
  values (v_uid, 'update', 'app_settings', 'ordering_status', v_value);

  -- Surfaces on the /status page next to the other cross-service events,
  -- so "why did orders stop at 8pm" is answerable without asking anyone.
  insert into public.system_events (source, severity, event, message, context)
  values (
    'dashboard',
    case when v_enabled then 'info' else 'warn' end,
    case when v_enabled then 'online_ordering_resumed' else 'online_ordering_paused' end,
    case when v_enabled
      then 'تم تشغيل الطلب الأونلاين لكل المطاعم'
      else coalesce(v_reason, 'تم إيقاف الطلب الأونلاين لكل المطاعم')
    end,
    v_value
  );

  return v_value;
end; $$;

revoke execute on function public.rpc_admin_set_ordering_status(boolean, text) from anon, public;
grant  execute on function public.rpc_admin_set_ordering_status(boolean, text) to authenticated;


-- ── 4) Hard stop on order creation ───────────────────────────
create or replace function public.tg_orders_block_when_ordering_paused()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_online_ordering_paused() then
    return new;
  end if;

  -- Ops keep a way in: seeding, and orders taken over the phone during
  -- the very outage the switch is covering.
  if public.is_admin() then
    return new;
  end if;

  -- The test restaurant stays orderable so we can prove the platform works
  -- again before letting customers back in.
  if exists (
    select 1 from public.restaurants r
    where r.id = new.restaurant_id and coalesce(r.is_test, false)
  ) then
    return new;
  end if;

  raise exception 'ordering_paused' using errcode = 'P0001';
end; $$;

drop trigger if exists trg_orders_block_when_ordering_paused on public.orders;
create trigger trg_orders_block_when_ordering_paused
  before insert on public.orders
  for each row execute function public.tg_orders_block_when_ordering_paused();


-- ── 5) rpc_add_to_cart v3 — reject before a cart is built ────
-- Identical to 055 apart from the global check added ahead of the
-- per-restaurant one.
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
  v_rest             record;
  v_first_rest_id    uuid;
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

  -- A restaurant that turned off online orders or flipped itself to
  -- "busy" must not receive new cart items. The mobile app blocks this
  -- in the UI too, but the flag can change while the menu is open —
  -- the server is the source of truth.
  if not coalesce(v_rest.accepts_online_orders, false)
     or not coalesce(v_rest.is_accepting_orders, false) then
    return jsonb_build_object('error', 'not_accepting_orders');
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


-- ── 6) Realtime ──────────────────────────────────────────────
-- `app_settings` so a phone already sitting on the home grid sees the
-- pause within a second instead of on next foreground.
--
-- `restaurants` fixes a pre-existing dead subscription: RestaurantsCubit
-- has been subscribing to postgres_changes on `restaurants` since the busy
-- badge shipped, but the table was never added to the publication, so the
-- "مشغول حالياً" badge only ever updated on a manual refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'restaurants'
  ) then
    alter publication supabase_realtime add table public.restaurants;
  end if;
end $$;
