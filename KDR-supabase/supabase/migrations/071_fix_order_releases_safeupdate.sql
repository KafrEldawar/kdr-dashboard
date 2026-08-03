-- ============================================================
-- 071: rpc_admin_get_order_releases — drop the temp table.
--
-- Bug:
--   Opening "الطلبات المتروكة" in the dashboard always failed with
--   `DELETE requires a WHERE clause`. Nothing in the page deletes
--   anything — the error came from inside the RPC. 069 staged the
--   release rows in a session temp table and cleared it with a bare
--   `delete from _releases;`, and Supabase preloads `safeupdate` on
--   the `authenticator` role (the role PostgREST connects as), which
--   rejects any unqualified DELETE/UPDATE. So the function worked
--   when run as `postgres` and failed for every real caller.
--
-- Fix:
--   The temp table only ever existed to force the regex filter to run
--   before the `record_id::uuid` cast — `record_id` is free-form text
--   across the rest of audit_logs, so casting an unrelated row blows
--   up. A CASE expression gives that ordering guarantee directly
--   (CASE is one of the few places Postgres guarantees short-circuit
--   evaluation), so the whole function collapses into one query with
--   a MATERIALIZED CTE and no session state to clean up.
--
--   Also tightens the UUID guard: `^[0-9a-fA-F-]{36}$` accepted any
--   36-character mix of hex and dashes (36 dashes passed), which
--   would still fail the cast. The pattern now matches the real
--   8-4-4-4-12 shape.
-- ============================================================

create or replace function public.rpc_admin_get_order_releases(
  p_from      date    default null,
  p_to        date    default null,
  p_page      integer default 1,
  p_page_size integer default 30
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_page      integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 30), 1), 200);
  v_offset    integer := (v_page - 1) * v_page_size;
  v_total     integer;
  v_data      jsonb;
  v_by_driver jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Not an admin');
  end if;

  with releases as materialized (
    select
      a.id,
      a.created_at,
      a.user_id,
      -- CASE guarantees the cast never runs on a non-uuid record_id.
      case
        when a.record_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then a.record_id::uuid
      end as order_id,
      a.new_data->>'reason' as reason
    from audit_logs a
    where a.table_name = 'orders'
      and a.new_data->>'action' = 'release'
      and a.record_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and (p_from is null or (a.created_at at time zone 'Africa/Cairo')::date >= p_from)
      and (p_to   is null or (a.created_at at time zone 'Africa/Cairo')::date <= p_to)
  ),
  page as (
    select
      rel.id,
      rel.created_at,
      rel.order_id,
      rel.reason,
      p.full_name                     as driver_name,
      p.phone                         as driver_phone,
      coalesce(dp.kind, 'individual') as provider_kind,
      dp.display_name                 as office_name,
      o.status::text                  as order_status,
      o.delivery_address,
      o.total_amount,
      r.name_ar                       as restaurant_name
    from releases rel
    left join profiles p            on p.id  = rel.user_id
    left join delivery_providers dp on dp.id = rel.user_id
    left join orders o              on o.id  = rel.order_id
    left join restaurants r         on r.id  = o.restaurant_id
    order by rel.created_at desc
    limit v_page_size offset v_offset
  ),
  -- The per-driver tally is the actual point: one release is noise, six
  -- from the same rider in a week is a conversation. Counted over the
  -- whole filtered range, not just the visible page.
  tally as (
    select
      rel.user_id                     as driver_id,
      p.full_name                     as driver_name,
      coalesce(dp.kind, 'individual') as provider_kind,
      count(*)                        as releases
    from releases rel
    left join profiles p            on p.id  = rel.user_id
    left join delivery_providers dp on dp.id = rel.user_id
    group by rel.user_id, p.full_name, dp.kind
  )
  select
    (select count(*)::integer from releases),
    coalesce((select jsonb_agg(t order by t.created_at desc) from page t), '[]'::jsonb),
    coalesce((select jsonb_agg(t order by t.releases desc)   from tally t), '[]'::jsonb)
  into v_total, v_data, v_by_driver;

  return jsonb_build_object(
    'data', v_data,
    'by_driver', v_by_driver,
    'meta', jsonb_build_object(
      'total', v_total,
      'page', v_page,
      'page_size', v_page_size,
      'total_pages', ceil(v_total::numeric / v_page_size)
    )
  );
end; $$;

revoke execute on function public.rpc_admin_get_order_releases(date, date, integer, integer) from anon, public;
grant  execute on function public.rpc_admin_get_order_releases(date, date, integer, integer) to authenticated;
