-- ============================================================
-- 069: Admin view of released (abandoned) delivery orders.
--
-- Why:
--   Migration 067 added rpc_driver_release_order and the app now requires
--   a reason before it will submit one. That reason lands on the release
--   audit entry, where nothing could read it back — so the signal it
--   exists to capture (a rider who keeps dropping far addresses, a
--   restaurant that is always late) was being written and forgotten.
--
--   Reads from audit_logs rather than a new table: the entry is already
--   written inside the release transaction, so a separate table would be
--   a second source of truth that could disagree with it.
-- ============================================================

create or replace function public.rpc_admin_get_order_releases(
  p_from      date    default null,
  p_to        date    default null,
  p_page      integer default 1,
  p_page_size integer default 30
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (greatest(p_page, 1) - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
  v_by_driver jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Not an admin');
  end if;

  -- Narrow to release entries FIRST. `record_id` is free-form text across
  -- the rest of audit_logs, so casting it to uuid before filtering would
  -- blow up on unrelated rows.
  create temp table if not exists _releases (
    id uuid, created_at timestamptz, user_id uuid, order_id uuid, reason text
  ) on commit drop;
  delete from _releases;

  insert into _releases
  select a.id, a.created_at, a.user_id, a.record_id::uuid, a.new_data->>'reason'
  from audit_logs a
  where a.table_name = 'orders'
    and a.new_data->>'action' = 'release'
    and a.record_id ~ '^[0-9a-fA-F-]{36}$'
    and (p_from is null or (a.created_at at time zone 'Africa/Cairo')::date >= p_from)
    and (p_to   is null or (a.created_at at time zone 'Africa/Cairo')::date <= p_to);

  select count(*) into v_total from _releases;

  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
  into v_data
  from (
    select
      rel.id,
      rel.created_at,
      rel.order_id,
      rel.reason,
      p.full_name  as driver_name,
      p.phone      as driver_phone,
      coalesce(dp.kind, 'individual') as provider_kind,
      dp.display_name as office_name,
      o.status::text  as order_status,
      o.delivery_address,
      o.total_amount,
      r.name_ar as restaurant_name
    from _releases rel
    left join profiles p            on p.id  = rel.user_id
    left join delivery_providers dp on dp.id = rel.user_id
    left join orders o              on o.id  = rel.order_id
    left join restaurants r         on r.id  = o.restaurant_id
    order by rel.created_at desc
    limit p_page_size offset v_offset
  ) t;

  -- The per-driver tally is the actual point: one release is noise, six
  -- from the same rider in a week is a conversation.
  select coalesce(jsonb_agg(t order by t.releases desc), '[]'::jsonb)
  into v_by_driver
  from (
    select
      rel.user_id                     as driver_id,
      p.full_name                     as driver_name,
      coalesce(dp.kind, 'individual') as provider_kind,
      count(*)                        as releases
    from _releases rel
    left join profiles p            on p.id  = rel.user_id
    left join delivery_providers dp on dp.id = rel.user_id
    group by rel.user_id, p.full_name, dp.kind
  ) t;

  return jsonb_build_object(
    'data', v_data,
    'by_driver', v_by_driver,
    'meta', jsonb_build_object(
      'total', v_total,
      'page', greatest(p_page, 1),
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / greatest(p_page_size, 1))
    )
  );
end; $$;

revoke execute on function public.rpc_admin_get_order_releases(date, date, integer, integer) from anon, public;
