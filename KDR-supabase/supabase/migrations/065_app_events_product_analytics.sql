-- ============================================================
-- 065: First-party product analytics (`app_events`)
--
-- The mobile app currently reports nothing about how it is used.
-- `firebase_core` / `messaging` / `crashlytics` / `remote_config`
-- are all wired up, but there is no `firebase_analytics` and not a
-- single `logEvent` anywhere in `lib/` — so "which features do
-- people actually use?" has no answer and no history.
--
-- This adds the first-party half of the fix. Firebase Analytics
-- ships alongside it in the app for the free GA4 retention and
-- demographics reports, but GA4 cannot be queried from the KDR
-- dashboard without a BigQuery export and can never be joined to
-- an `orders` row. This table can do both, which is why it is the
-- primary store rather than the backup.
--
-- Design notes:
--
--   • Ingest goes through `rpc_track_events` only. The table has
--     RLS on with *no* policies, so PostgREST cannot touch it
--     directly — the SECURITY DEFINER RPC is the sole writer. That
--     keeps the write path validated (name shape, batch cap, rate
--     limit) instead of handing `anon` an INSERT policy on a table
--     that would then be trivially floodable.
--
--   • Events are batched by the client, so one call carries many
--     rows. `p_events` is a jsonb array.
--
--   • `occurred_at` is the device clock, `created_at` is ours.
--     Phones have wrong clocks; keeping both means a skewed device
--     can be detected instead of silently poisoning every report.
--
--   • Guests are tracked too (`user_id` null, `session_id` set).
--     Browsing before login is exactly the funnel step we most
--     need to see, so restricting this to `authenticated` would
--     blind the top of the funnel.
--
-- Additive: no existing table, function, policy or trigger is
-- touched, and nothing the mobile app calls today changes.
-- ============================================================


-- ── 1) Table ──────────────────────────────────────────────────
create table if not exists public.app_events (
  id           bigint generated always as identity primary key,
  -- Null for guests. ON DELETE SET NULL so account deletion
  -- (rpc_delete_my_account, migration 041) anonymises the history
  -- instead of cascading it away — aggregate reports stay honest.
  user_id      uuid references auth.users(id) on delete set null,
  -- Client-generated, one per app launch. Ties a guest's events
  -- together and survives the moment they sign in mid-session.
  session_id   text not null,
  event        text not null,
  props        jsonb not null default '{}'::jsonb,
  platform     text,
  app_version  text,
  occurred_at  timestamptz not null,
  created_at   timestamptz not null default now(),

  -- Shape guards. These are the only thing standing between the
  -- table and a client sending arbitrary junk, so they are checks
  -- rather than trusting the app to behave.
  constraint app_events_event_format check (event ~ '^[a-z][a-z0-9_]{2,49}$'),
  constraint app_events_session_len   check (length(session_id) between 8 and 64),
  -- `length(props::text)` rather than `pg_column_size(props)`: the latter
  -- is only STABLE, and CHECK expressions must be IMMUTABLE. Whatever
  -- expression is used here has to be the exact same one the ingest RPC
  -- filters on, or a row could pass the RPC's filter and then trip the
  -- constraint — which would abort the whole batch, not just that row.
  constraint app_events_props_size    check (length(props::text) <= 4096),
  constraint app_events_platform_ck   check (platform is null or platform in ('android', 'ios')),
  constraint app_events_version_len   check (app_version is null or length(app_version) <= 32)
);

comment on table public.app_events is
  'First-party product analytics. Written only via rpc_track_events; RLS denies all direct access.';
comment on column public.app_events.occurred_at is
  'Device clock at the moment the event fired. Compare against created_at to spot skewed devices.';

create index if not exists idx_app_events_occurred
  on public.app_events (occurred_at desc);
create index if not exists idx_app_events_event_occurred
  on public.app_events (event, occurred_at desc);
create index if not exists idx_app_events_user_occurred
  on public.app_events (user_id, occurred_at desc) where user_id is not null;
-- Supports the per-session rate limit below.
create index if not exists idx_app_events_session_created
  on public.app_events (session_id, created_at desc);

-- RLS on, zero policies: nothing reaches this table except through
-- the SECURITY DEFINER functions below.
alter table public.app_events enable row level security;


-- ── 2) rpc_track_events ───────────────────────────────────────
-- Batched ingest. Returns how many rows were accepted so the client
-- can tell "flushed" from "silently dropped".
--
-- Malformed individual events are skipped, not fatal: one bad row
-- in a batch of forty must not cost the other thirty-nine, and the
-- client has no way to retry selectively.
create or replace function public.rpc_track_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid       uuid := auth.uid();
  v_session   text;
  v_recent    integer;
  v_inserted  integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('error', 'p_events must be a JSON array');
  end if;

  if jsonb_array_length(p_events) = 0 then
    return jsonb_build_object('accepted', 0);
  end if;

  -- Batch cap. A well-behaved client flushes ~20 at a time.
  if jsonb_array_length(p_events) > 50 then
    return jsonb_build_object('error', 'Batch too large (max 50 events)');
  end if;

  v_session := p_events->0->>'session_id';
  if v_session is null or length(v_session) not between 8 and 64 then
    return jsonb_build_object('error', 'Missing or malformed session_id');
  end if;

  -- Rate limit per session: ~1000 events/hour is far above what the
  -- app generates and far below what a flood needs to matter.
  select count(*) into v_recent
  from app_events
  where session_id = v_session
    and created_at > now() - interval '1 hour';

  if v_recent >= 1000 then
    return jsonb_build_object('error', 'Rate limit exceeded for this session');
  end if;

  with incoming as (
    select
      v_uid                                         as user_id,
      e->>'session_id'                              as session_id,
      lower(btrim(e->>'event'))                     as event,
      coalesce(
        case when jsonb_typeof(e->'props') = 'object' then e->'props' end,
        '{}'::jsonb
      )                                             as props,
      nullif(e->>'platform', '')                    as platform,
      nullif(e->>'app_version', '')                 as app_version,
      -- Two hazards here, both from data we do not control.
      --
      -- The regex guard is load-bearing: an unparseable timestamp
      -- would raise, and a raise aborts the *entire* batch rather
      -- than skipping the one bad row — the opposite of what this
      -- function promises. Anything that isn't ISO-8601 falls back
      -- to server time instead of blowing up its forty neighbours.
      --
      -- The `least(..., now())` clamp handles the other direction:
      -- a device whose clock is set to 2031 would otherwise park
      -- events in the future and silently skew every time bucket.
      least(
        case
          when e->>'occurred_at' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}'
          then (e->>'occurred_at')::timestamptz
          else now()
        end,
        now()
      )                                             as occurred_at
    from jsonb_array_elements(p_events) as e
  ),
  valid as (
    select * from incoming
    where event ~ '^[a-z][a-z0-9_]{2,49}$'
      and session_id = v_session
      and length(session_id) between 8 and 64
      -- Must stay identical to the app_events_props_size constraint.
      and length(props::text) <= 4096
      and (platform is null or platform in ('android', 'ios'))
      and (app_version is null or length(app_version) <= 32)
      and occurred_at > now() - interval '7 days'
  ),
  ins as (
    insert into app_events
      (user_id, session_id, event, props, platform, app_version, occurred_at)
    select user_id, session_id, event, props, platform, app_version, occurred_at
    from valid
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object(
    'accepted', v_inserted,
    'received', jsonb_array_length(p_events)
  );
end; $$;

-- Guests must be able to report too — the pre-login funnel is the
-- part we most need to measure.
grant execute on function public.rpc_track_events(jsonb) to anon, authenticated;


-- ── 3) rpc_admin_get_product_analytics ────────────────────────
-- Everything the dashboard's product page renders, in one call:
-- headline totals, a daily active-user series, the event and screen
-- leaderboards, the browse→order funnel, and platform/version mix.
create or replace function public.rpc_admin_get_product_analytics(
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_from  timestamptz;
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  v_from := now() - make_interval(days => v_days);

  return jsonb_build_object(
    'range_days', v_days,
    'since',      v_from,

    'totals', (
      select jsonb_build_object(
        'events',        count(*),
        'sessions',      count(distinct session_id),
        'known_users',   count(distinct user_id),
        -- Sessions that never carried a user_id: pure guest traffic.
        'guest_sessions', count(distinct session_id) filter (where user_id is null),
        'events_today',  count(*) filter (where occurred_at >= date_trunc('day', now()))
      )
      from app_events where occurred_at >= v_from
    ),

    -- Daily active users + sessions. Built off generate_series so
    -- quiet days appear as zeros instead of vanishing from the chart.
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day',      d::date,
        'users',    coalesce(a.users, 0),
        'sessions', coalesce(a.sessions, 0),
        'events',   coalesce(a.events, 0)
      ) order by d)
      from generate_series(v_from::date, now()::date, interval '1 day') d
      left join (
        select occurred_at::date as day,
               count(distinct user_id)    as users,
               count(distinct session_id) as sessions,
               count(*)                   as events
        from app_events where occurred_at >= v_from
        group by 1
      ) a on a.day = d::date
    ), '[]'::jsonb),

    -- Which features get used, ranked. `users` matters more than
    -- `count` here: one power user firing an event 400 times is not
    -- the same signal as 400 people firing it once.
    'top_events', coalesce((
      select jsonb_agg(t order by (t->>'count')::bigint desc)
      from (
        select jsonb_build_object(
          'event', event,
          'count', count(*),
          'users', count(distinct coalesce(user_id::text, session_id))
        ) as t
        from app_events where occurred_at >= v_from
        group by event
        order by count(*) desc
        limit 25
      ) s
    ), '[]'::jsonb),

    'top_screens', coalesce((
      select jsonb_agg(t order by (t->>'views')::bigint desc)
      from (
        select jsonb_build_object(
          'screen', props->>'screen',
          'views',  count(*),
          'users',  count(distinct coalesce(user_id::text, session_id))
        ) as t
        from app_events
        where occurred_at >= v_from
          and event = 'screen_view'
          and props->>'screen' is not null
        group by props->>'screen'
        order by count(*) desc
        limit 20
      ) s
    ), '[]'::jsonb),

    -- Browse → order funnel, counted in distinct actors (user when
    -- known, session otherwise) so it reads as "how many people
    -- made it this far", not "how many taps happened".
    'funnel', (
      select jsonb_build_object(
        'restaurant_viewed',  count(distinct actor) filter (where event = 'restaurant_viewed'),
        'add_to_cart',        count(distinct actor) filter (where event = 'add_to_cart'),
        'checkout_started',   count(distinct actor) filter (where event = 'checkout_started'),
        'order_placed',       count(distinct actor) filter (where event = 'order_placed')
      )
      from (
        select coalesce(user_id::text, session_id) as actor, event
        from app_events where occurred_at >= v_from
      ) f
    ),

    -- Wrapped in a derived table like every other block here. Putting
    -- `group by platform` in the same query as the jsonb_agg would make
    -- the agg run *inside* each group and return one array per platform
    -- — several rows where a scalar subquery needs exactly one.
    'platforms', coalesce((
      select jsonb_agg(t order by (t->>'events')::bigint desc)
      from (
        select jsonb_build_object(
          'platform', coalesce(platform, 'unknown'),
          'sessions', count(distinct session_id),
          'events',   count(*)
        ) as t
        from app_events where occurred_at >= v_from
        group by platform
      ) s
    ), '[]'::jsonb),

    'versions', coalesce((
      select jsonb_agg(t order by (t->>'sessions')::bigint desc)
      from (
        select jsonb_build_object(
          'app_version', coalesce(app_version, 'unknown'),
          'sessions',    count(distinct session_id)
        ) as t
        from app_events where occurred_at >= v_from
        group by app_version
        order by count(distinct session_id) desc
        limit 12
      ) s
    ), '[]'::jsonb)
  );
end; $$;

grant execute on function public.rpc_admin_get_product_analytics(integer) to authenticated;


-- ── 4) Retention ──────────────────────────────────────────────
-- Raw events are only interesting while they are recent; the
-- aggregates are what matter long-term. Mirrors the pruning
-- already in place for `system_events` (migration 054).
create or replace function public.rpc_admin_prune_app_events(
  p_retention_days integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  delete from app_events
  where occurred_at < now() - make_interval(days => greatest(coalesce(p_retention_days, 180), 7));

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end; $$;

grant execute on function public.rpc_admin_prune_app_events(integer) to authenticated;
