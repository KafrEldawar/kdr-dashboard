-- ============================================================
-- 047: Pinned-order parameter for rpc_get_restaurants
--
-- Until now restaurants in the customer-facing list were ordered
-- strictly by created_at DESC. That made the home grid order an
-- accident of onboarding sequence — we had no way to surface a
-- "featured" restaurant first or run an editorial reshuffle
-- without rewriting created_at timestamps.
--
-- This migration extends `rpc_get_restaurants` with a new optional
-- parameter `p_pinned_ids uuid[]`. When supplied:
--   • Restaurants whose id is in the array are returned FIRST, in
--     the exact order of the array (array_position(...) ASC).
--   • Everything else falls through to the existing created_at DESC
--     ordering — so the rest of the list is unaffected.
--
-- The client (Flutter app) reads this array from Firebase Remote
-- Config under the `restaurants_ordering` key. That gives Ops a
-- live, no-deploy lever to:
--   • Pin a single restaurant to the top spot (featured slot)
--   • Reorder the first N restaurants for promotions
--   • Roll back instantly by emptying the array
--
-- No schema changes — only the function signature/body is patched.
--
-- NOTE on overloads: `create or replace function` only replaces a function
-- with the EXACT same signature. Because we're adding a new parameter, the
-- new function is a separate overload — the old 6-arg version would still
-- be resolvable. We therefore drop the old signature first so PostgREST
-- (and direct callers) unambiguously resolve to the new function.
-- ============================================================

drop function if exists public.rpc_get_restaurants(
  integer, integer, text, uuid, boolean, boolean
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
    -- Pinned IDs come first in array order; everyone else by created_at DESC.
    -- NULLS LAST ensures non-pinned rows (array_position returns NULL) sink
    -- to the bottom of the first sort key, where the second key takes over.
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
