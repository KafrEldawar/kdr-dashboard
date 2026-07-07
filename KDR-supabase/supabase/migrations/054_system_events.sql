-- ============================================================
-- 054: System events + status feed
-- ============================================================
-- Cross-service event log used by the dashboard /status page.
-- Producers today: whatsapp-sender-backend (Railway) reports its
-- own reboot storms, wipes, and 515s so the operator can spot an
-- outage without SSHing into logs. Consumers: rpc_admin_get_system_events
-- powers the timeline on /status; rpc_system_status_summary powers the
-- health cards (last-5-minute counts by severity).
--
-- Why not a plain audit table:
--   * severity is enum-like so we can render color chips cheaply
--   * indexed on (ts desc) and (source, ts desc) because the UI
--     always filters "latest first" and sometimes "just whatsapp"
--   * a 30-day retention job (see rpc_prune_system_events) keeps
--     the table from growing unbounded — call it from cron / a
--     Supabase scheduled function.

create table if not exists public.system_events (
  id        uuid primary key default gen_random_uuid(),
  ts        timestamptz not null default now(),
  source    text not null,
  severity  text not null check (severity in ('info', 'warn', 'error')),
  event     text not null,
  message   text,
  context   jsonb
);

create index if not exists idx_system_events_ts        on public.system_events (ts desc);
create index if not exists idx_system_events_source_ts on public.system_events (source, ts desc);
create index if not exists idx_system_events_sev_ts    on public.system_events (severity, ts desc);

-- Producers use service_role via the dashboard proxy — no direct
-- writer RLS is needed. Reads are gated by is_admin() on the RPC.
alter table public.system_events enable row level security;
-- No policies → only postgres/service_role can touch the table
-- outside of the security-definer RPCs below.

-- ── Insert RPC (called by dashboard /api/system-events) ─────
create or replace function public.rpc_log_system_event(
  p_source   text,
  p_severity text,
  p_event    text,
  p_message  text default null,
  p_context  jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_severity not in ('info', 'warn', 'error') then
    raise exception 'severity must be one of info|warn|error';
  end if;
  if coalesce(trim(p_source), '') = '' or coalesce(trim(p_event), '') = '' then
    raise exception 'source and event are required';
  end if;

  insert into public.system_events (source, severity, event, message, context)
  values (p_source, p_severity, p_event, p_message, p_context)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Read RPC (admin dashboard timeline) ────────────────────
create or replace function public.rpc_admin_get_system_events(
  p_limit    int default 100,
  p_severity text default null,
  p_source   text default null,
  p_since    timestamptz default (now() - interval '24 hours')
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  select coalesce(jsonb_agg(row_to_json(e) order by e.ts desc), '[]'::jsonb)
    into v_rows
  from (
    select id, ts, source, severity, event, message, context
    from public.system_events
    where ts >= p_since
      and (p_severity is null or severity = p_severity)
      and (p_source   is null or source   = p_source)
    order by ts desc
    limit greatest(1, least(p_limit, 500))
  ) e;

  return jsonb_build_object('events', v_rows);
end;
$$;

-- ── Summary RPC (health-card counts) ───────────────────────
-- Returns per-severity counts for the last N minutes so the /status
-- page can flash a red badge when errors are actively piling up.
create or replace function public.rpc_admin_system_status_summary(
  p_window_minutes int default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since  timestamptz;
  v_counts jsonb;
  v_by_source jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  v_since := now() - make_interval(mins => greatest(1, p_window_minutes));

  select jsonb_object_agg(severity, cnt)
    into v_counts
  from (
    select severity, count(*)::int as cnt
    from public.system_events
    where ts >= v_since
    group by severity
  ) s;

  select jsonb_agg(row_to_json(s) order by s.errors desc, s.warns desc)
    into v_by_source
  from (
    select
      source,
      count(*) filter (where severity = 'error')::int as errors,
      count(*) filter (where severity = 'warn')::int  as warns,
      count(*) filter (where severity = 'info')::int  as infos,
      max(ts) as last_ts
    from public.system_events
    where ts >= v_since
    group by source
  ) s;

  return jsonb_build_object(
    'window_minutes', p_window_minutes,
    'counts',         coalesce(v_counts, '{}'::jsonb),
    'by_source',      coalesce(v_by_source, '[]'::jsonb)
  );
end;
$$;

-- ── Retention RPC ──────────────────────────────────────────
-- Delete rows older than the retention window. Call from a Supabase
-- scheduled function (pg_cron) — see /status page for the operator
-- one-shot button.
create or replace function public.rpc_admin_prune_system_events(
  p_retention_days int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  delete from public.system_events
    where ts < now() - make_interval(days => greatest(1, p_retention_days));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

grant execute on function public.rpc_log_system_event(text, text, text, text, jsonb)      to authenticated, service_role;
grant execute on function public.rpc_admin_get_system_events(int, text, text, timestamptz) to authenticated;
grant execute on function public.rpc_admin_system_status_summary(int)                     to authenticated;
grant execute on function public.rpc_admin_prune_system_events(int)                       to authenticated;
