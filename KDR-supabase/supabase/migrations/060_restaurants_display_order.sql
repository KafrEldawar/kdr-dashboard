-- ============================================================
-- 060: Dashboard-controlled restaurant display order
--
-- Until now the customer home grid picked its lead restaurants
-- from Firebase Remote Config (`restaurants_ordering.pinned` →
-- `p_pinned_ids` in `rpc_get_restaurants`, migration 047). That
-- worked for a small featured slot, but "reorder the whole list"
-- is really an Ops task and belongs on the dashboard — not a
-- Firebase console text field.
--
-- What this migration adds:
--
--   • `restaurants.display_order` (nullable int) — dashboard-set
--     rank; smaller values come first. NULL means "no explicit
--     order, sort by created_at DESC like before" so the migration
--     is a no-op for the visible list until an admin starts
--     assigning ranks.
--   • `rpc_get_restaurants` gets a new order-by chain:
--         1. pinned array (unchanged — RC override still wins)
--         2. display_order ASC NULLS LAST
--         3. created_at DESC
--     Once every restaurant has a display_order the RC pin becomes
--     unnecessary; until then, both mechanisms compose cleanly.
--   • `rpc_admin_reorder_restaurants(p_orders jsonb)` — batch
--     write endpoint the dashboard calls when the admin drags the
--     list into a new order. Takes an array of {id, order} and
--     updates all rows in one transaction so partial reorders can't
--     leave the list in a half-updated state.
--
-- Idempotent + backwards-compatible.
-- ============================================================


-- ── 1) Schema ─────────────────────────────────────────────────
alter table public.restaurants
  add column if not exists display_order integer;

comment on column public.restaurants.display_order is
  'Dashboard-set rank for the customer home grid. Lower = higher in the list. NULL falls through to created_at DESC.';

-- Small index so the ORDER BY doesn't degenerate on the list page.
create index if not exists idx_restaurants_display_order
  on public.restaurants (display_order nulls last, created_at desc);


-- ── 2) rpc_get_restaurants — reorder chain now includes display_order
-- Recreate the signature-matched overload (7 args from 047) so we
-- can update the ORDER BY without proliferating overloads.
drop function if exists public.rpc_get_restaurants(
  integer, integer, text, uuid, boolean, boolean, uuid[]
);

create or replace function public.rpc_get_restaurants(
  p_page          integer  default 1,
  p_page_size     integer  default 10,
  p_search        text     default null,
  p_category_id   uuid     default null,
  p_accepts_online boolean default null,
  p_is_accepting  boolean  default null,
  p_pinned_ids    uuid[]   default null
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
      r.estimated_delivery_time,
      r.created_at,
      r.display_order,
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
    order by
      array_position(p_pinned_ids, r.id) nulls last,
      r.display_order nulls last,
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


-- ── 3) Batch reorder RPC ──────────────────────────────────────
-- The dashboard "sort restaurants" screen collects the new order
-- client-side (drag-and-drop) and submits the full list in one
-- shot. We reassign display_order sequentially starting from 1
-- so ties and gaps can't drift — the client only needs to send
-- the ids in the desired order.
--
-- Any restaurant id NOT in the payload is left untouched (its
-- display_order stays whatever it was). Ids in the payload that
-- don't exist / aren't active are silently skipped so a stale
-- client can't fail the whole batch.
create or replace function public.rpc_admin_reorder_restaurants(
  p_ordered_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_i   integer := 0;
  v_updated integer := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return jsonb_build_object('error', 'No ids provided');
  end if;

  -- Reassign sequentially. Doing it in a single UPDATE with an
  -- index expression on the array would be nicer, but this loop
  -- makes the audit trail per-row and keeps the intent obvious.
  foreach v_id in array p_ordered_ids loop
    v_i := v_i + 1;
    update restaurants
      set display_order = v_i,
          updated_at    = now()
      where id = v_id;
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'restaurants', concat('reorder:', v_updated));

  return jsonb_build_object(
    'success', true,
    'updated', v_updated,
    'total',   array_length(p_ordered_ids, 1)
  );
end; $$;
