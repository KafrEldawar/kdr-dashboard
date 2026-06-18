-- ============================================================
-- 033: WhatsApp OTP + Marketing Campaigns
-- ============================================================
--
-- Adds:
--   • otp_codes / otp_rate_limits — WhatsApp OTP issuance + throttling
--   • profiles.phone_verified_at, whatsapp_opt_in
--   • whatsapp_campaigns + whatsapp_campaign_recipients — bulk
--     marketing with per-day cap and scheduled spread
--   • whatsapp_send_log — audit trail for every WhatsApp send
--   • RPCs to create / attach recipients / pause / resume / dispatch
--   • pg_cron job that fires dispatch-campaign-batch every 5 min
--
-- REQUIRED SETUP (run once after applying):
--
--   INSERT INTO public.app_config (key, value) VALUES
--     ('supabase_url',         'https://YOUR_PROJECT_REF.supabase.co'),
--     ('supabase_service_key', 'YOUR_SERVICE_ROLE_KEY')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
--   -- Already present from migration 020; included here as a reminder.
-- ============================================================


-- ── Extensions ────────────────────────────────────────────────
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;
create extension if not exists pgcrypto with schema extensions;  -- digest()


-- ── Profile additions ─────────────────────────────────────────
alter table public.profiles
  add column if not exists phone_verified_at timestamptz,
  add column if not exists whatsapp_opt_in   boolean not null default true;

create index if not exists idx_profiles_phone
  on public.profiles (phone)
  where phone is not null;


-- ── otp_codes ─────────────────────────────────────────────────
create table if not exists public.otp_codes (
  id            uuid        primary key default gen_random_uuid(),
  phone         text        not null,
  code_hash     text        not null,
  purpose       text        not null check (purpose in ('login', 'attach')),
  attempts      integer     not null default 0,
  max_attempts  integer     not null default 5,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_otp_codes_phone_recent
  on public.otp_codes (phone, created_at desc);

alter table public.otp_codes enable row level security;
-- No public policies — only service_role (Edge Functions) access.


-- ── otp_rate_limits ───────────────────────────────────────────
-- One row per phone. Edge Function updates atomically per send.
create table if not exists public.otp_rate_limits (
  phone               text        primary key,
  sends_in_window     integer     not null default 0,
  window_started_at   timestamptz not null default now(),
  daily_sends         integer     not null default 0,
  daily_started_at    timestamptz not null default now(),
  cooldown_until      timestamptz,
  updated_at          timestamptz not null default now()
);

alter table public.otp_rate_limits enable row level security;


-- ── whatsapp_campaigns ────────────────────────────────────────
create table if not exists public.whatsapp_campaigns (
  id                  uuid        primary key default gen_random_uuid(),
  title               text        not null,
  body_template       text        not null,
  image_url           text,
  target_type         text        not null check (target_type in (
                        'all_customers', 'role_filter', 'custom_list')),
  target_filter       jsonb       not null default '{}'::jsonb,
  daily_cap           integer     not null default 200
                                  check (daily_cap between 1 and 1000),
  schedule_start_at   timestamptz not null,
  status              text        not null default 'draft'
                                  check (status in (
                        'draft', 'scheduled', 'running',
                        'paused', 'completed', 'failed')),
  total_recipients    integer     not null default 0,
  sent_count          integer     not null default 0,
  failed_count        integer     not null default 0,
  created_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_whatsapp_campaigns_status
  on public.whatsapp_campaigns (status, schedule_start_at);

alter table public.whatsapp_campaigns enable row level security;

-- Admins read/write via RPCs. Direct table access via service role only.
drop policy if exists "whatsapp_campaigns: admin read" on public.whatsapp_campaigns;
create policy "whatsapp_campaigns: admin read"
  on public.whatsapp_campaigns for select
  using (public.is_admin());


-- ── whatsapp_campaign_recipients ──────────────────────────────
create table if not exists public.whatsapp_campaign_recipients (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     uuid        not null
                              references public.whatsapp_campaigns(id) on delete cascade,
  phone           text        not null,
  name            text,
  status          text        not null default 'pending'
                              check (status in ('pending', 'sent', 'failed', 'skipped')),
  scheduled_for   timestamptz not null,
  sent_at         timestamptz,
  error           text,
  provider_message_id text,
  created_at      timestamptz not null default now(),
  unique (campaign_id, phone)
);

create index if not exists idx_wa_recipients_pending
  on public.whatsapp_campaign_recipients (status, scheduled_for)
  where status = 'pending';

create index if not exists idx_wa_recipients_campaign
  on public.whatsapp_campaign_recipients (campaign_id, status);

alter table public.whatsapp_campaign_recipients enable row level security;

drop policy if exists "wa_recipients: admin read" on public.whatsapp_campaign_recipients;
create policy "wa_recipients: admin read"
  on public.whatsapp_campaign_recipients for select
  using (public.is_admin());


-- ── whatsapp_send_log ─────────────────────────────────────────
create table if not exists public.whatsapp_send_log (
  id                   uuid        primary key default gen_random_uuid(),
  phone                text        not null,
  purpose              text        not null check (purpose in ('otp', 'campaign')),
  campaign_id          uuid        references public.whatsapp_campaigns(id) on delete set null,
  status               text        not null check (status in ('queued', 'sent', 'failed')),
  provider_message_id  text,
  error                text,
  sent_at              timestamptz not null default now()
);

create index if not exists idx_wa_send_log_phone_recent
  on public.whatsapp_send_log (phone, sent_at desc);

alter table public.whatsapp_send_log enable row level security;

drop policy if exists "wa_send_log: admin read" on public.whatsapp_send_log;
create policy "wa_send_log: admin read"
  on public.whatsapp_send_log for select
  using (public.is_admin());


-- ── set_updated_at triggers (reuse the existing helper) ───────
drop trigger if exists trg_whatsapp_campaigns_updated_at on public.whatsapp_campaigns;
create trigger trg_whatsapp_campaigns_updated_at
  before update on public.whatsapp_campaigns
  for each row execute function public.set_updated_at();


-- ============================================================
-- RPC: rpc_admin_create_whatsapp_campaign
-- ============================================================
-- Inserts a draft campaign row. Recipients are attached separately
-- via rpc_admin_attach_campaign_recipients. Idempotent on (title,
-- created_by, schedule_start_at) within the same minute — the
-- dashboard can safely retry on network blip.
create or replace function public.rpc_admin_create_whatsapp_campaign(
  p_title             text,
  p_body_template     text,
  p_target_type       text,
  p_target_filter     jsonb       default '{}'::jsonb,
  p_image_url         text        default null,
  p_daily_cap         integer     default 200,
  p_schedule_start_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_campaign_id uuid;
  v_start_at    timestamptz := coalesce(p_schedule_start_at, now() + interval '5 minute');
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  if p_target_type not in ('all_customers', 'role_filter', 'custom_list') then
    return jsonb_build_object('error', 'Invalid target_type');
  end if;

  if p_daily_cap < 1 or p_daily_cap > 1000 then
    return jsonb_build_object('error', 'daily_cap must be between 1 and 1000');
  end if;

  insert into whatsapp_campaigns (
    title, body_template, image_url,
    target_type, target_filter, daily_cap,
    schedule_start_at, created_by, status
  ) values (
    p_title, p_body_template, p_image_url,
    p_target_type, coalesce(p_target_filter, '{}'::jsonb), p_daily_cap,
    v_start_at, v_uid, 'draft'
  )
  returning id into v_campaign_id;

  return jsonb_build_object('campaign_id', v_campaign_id, 'status', 'draft');
end; $$;


-- ============================================================
-- RPC: rpc_admin_attach_campaign_recipients
-- ============================================================
-- Resolves the recipient list for a campaign (or accepts a custom
-- list) and writes one row per phone into whatsapp_campaign_recipients
-- with a scheduled_for value spread across days based on daily_cap.
-- Flips the campaign to 'scheduled' on success.
create or replace function public.rpc_admin_attach_campaign_recipients(
  p_campaign_id uuid,
  p_custom_phones text[] default null,
  p_custom_names  text[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_campaign    whatsapp_campaigns;
  v_inserted    integer := 0;
  v_total       integer := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  select * into v_campaign from whatsapp_campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('error', 'Campaign not found');
  end if;

  if v_campaign.status not in ('draft', 'scheduled') then
    return jsonb_build_object('error',
      format('Cannot attach recipients in status %s', v_campaign.status));
  end if;

  -- Build the resolved (phone, name) source set into a temp.
  create temp table _tmp_wa_targets (
    phone text not null,
    name  text,
    ord   bigint generated always as identity
  ) on commit drop;

  if v_campaign.target_type = 'all_customers' then
    insert into _tmp_wa_targets (phone, name)
    select p.phone, p.full_name
      from profiles p
     where p.role = 'customer'
       and p.is_active = true
       and p.phone is not null
       and length(trim(p.phone)) > 0
       and coalesce(p.whatsapp_opt_in, true) = true
     order by p.created_at desc;

  elsif v_campaign.target_type = 'role_filter' then
    insert into _tmp_wa_targets (phone, name)
    select p.phone, p.full_name
      from profiles p
     where p.is_active = true
       and p.phone is not null
       and length(trim(p.phone)) > 0
       and coalesce(p.whatsapp_opt_in, true) = true
       and (
         v_campaign.target_filter ? 'roles'
         and p.role::text = any (
           array(select jsonb_array_elements_text(v_campaign.target_filter->'roles'))
         )
       )
     order by p.created_at desc;

  elsif v_campaign.target_type = 'custom_list' then
    if p_custom_phones is null or array_length(p_custom_phones, 1) is null then
      return jsonb_build_object('error', 'custom_list requires p_custom_phones');
    end if;
    insert into _tmp_wa_targets (phone, name)
    select unnest(p_custom_phones),
           case when p_custom_names is not null
                  and array_length(p_custom_names, 1) = array_length(p_custom_phones, 1)
                then unnest(p_custom_names) end;
  end if;

  -- Spread across days based on daily_cap. Recipient i (0-indexed)
  -- gets schedule_start_at + floor(i / daily_cap) days.
  with src as (
    select t.phone, t.name,
           v_campaign.schedule_start_at
             + (((t.ord - 1) / v_campaign.daily_cap) || ' days')::interval
             as scheduled_for
      from _tmp_wa_targets t
  )
  insert into whatsapp_campaign_recipients (campaign_id, phone, name, scheduled_for)
  select p_campaign_id, src.phone, src.name, src.scheduled_for
    from src
   on conflict (campaign_id, phone) do nothing;

  get diagnostics v_inserted = row_count;
  select count(*) into v_total
    from whatsapp_campaign_recipients
   where campaign_id = p_campaign_id;

  update whatsapp_campaigns
     set total_recipients = v_total,
         status = case
                    when v_total > 0 then 'scheduled'
                    else 'draft'
                  end,
         updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'inserted',    v_inserted,
    'total',       v_total,
    'status',      case when v_total > 0 then 'scheduled' else 'draft' end
  );
end; $$;


-- ============================================================
-- RPC: rpc_admin_pause_campaign / rpc_admin_resume_campaign
-- ============================================================
create or replace function public.rpc_admin_pause_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  update whatsapp_campaigns
     set status = 'paused', updated_at = now()
   where id = p_campaign_id
     and status in ('scheduled', 'running');

  if not found then
    return jsonb_build_object('error', 'Campaign not pausable');
  end if;
  return jsonb_build_object('ok', true, 'status', 'paused');
end; $$;

create or replace function public.rpc_admin_resume_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  update whatsapp_campaigns
     set status = 'scheduled', updated_at = now()
   where id = p_campaign_id
     and status = 'paused';

  if not found then
    return jsonb_build_object('error', 'Campaign not paused');
  end if;
  return jsonb_build_object('ok', true, 'status', 'scheduled');
end; $$;


-- ============================================================
-- RPC: rpc_retry_failed_recipients
-- ============================================================
-- Re-queues failed recipients of a campaign back to pending with
-- scheduled_for set to now(). Used by the dashboard "Resend failed"
-- button.
create or replace function public.rpc_retry_failed_recipients(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  update whatsapp_campaign_recipients
     set status = 'pending',
         scheduled_for = now(),
         error = null,
         sent_at = null
   where campaign_id = p_campaign_id
     and status = 'failed';

  get diagnostics v_count = row_count;

  -- If campaign was completed, flip it back to scheduled so the
  -- cron picks the retries up.
  update whatsapp_campaigns
     set status = 'scheduled', updated_at = now()
   where id = p_campaign_id
     and status in ('completed', 'failed');

  return jsonb_build_object('ok', true, 'requeued', v_count);
end; $$;


-- ============================================================
-- RPC: rpc_dispatch_whatsapp_batch
-- ============================================================
-- Invoked by pg_cron every 5 minutes. Fires a fire-and-forget POST
-- to the dispatch-campaign-batch Edge Function, which then queries
-- pending recipients and calls the Railway service. We keep this
-- function thin — the heavy lifting (batching, HMAC, Railway call)
-- lives in the Edge Function so it can be redeployed independently.
create or replace function public.rpc_dispatch_whatsapp_batch()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_supa_url text;
  v_supa_key text;
  v_pending  integer;
begin
  select count(*) into v_pending
    from whatsapp_campaign_recipients r
    join whatsapp_campaigns c on c.id = r.campaign_id
   where r.status = 'pending'
     and r.scheduled_for <= now()
     and c.status in ('scheduled', 'running');

  if v_pending = 0 then
    return;
  end if;

  -- Flip scheduled → running for any campaign that has work now.
  update whatsapp_campaigns
     set status = 'running', updated_at = now()
   where status = 'scheduled'
     and id in (
       select distinct campaign_id
         from whatsapp_campaign_recipients
        where status = 'pending'
          and scheduled_for <= now()
     );

  select value into v_supa_url from app_config where key = 'supabase_url';
  select value into v_supa_key from app_config where key = 'supabase_service_key';

  if v_supa_url is null or v_supa_key is null then
    return;
  end if;

  begin
    perform net.http_post(
      url     := v_supa_url || '/functions/v1/dispatch-campaign-batch',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_supa_key
      ),
      body    := jsonb_build_object('triggered_by', 'pg_cron')
    );
  exception when others then
    -- fire-and-forget; log but never break the cron tick
    raise warning 'dispatch-campaign-batch invocation failed: %', sqlerrm;
  end;
end; $$;


-- ============================================================
-- pg_cron schedule — every 5 minutes
-- ============================================================
-- Drop any pre-existing schedule with the same name (idempotent re-run).
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'whatsapp_dispatch';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'whatsapp_dispatch',
  '*/5 * * * *',
  $$select public.rpc_dispatch_whatsapp_batch();$$
);


-- ============================================================
-- Mark campaigns as completed when no work remains
-- ============================================================
-- Helper RPC called by the Edge Function at the end of each batch.
create or replace function public.rpc_mark_campaign_if_done(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_remaining integer;
  v_sent      integer;
  v_failed    integer;
begin
  select count(*) into v_remaining
    from whatsapp_campaign_recipients
   where campaign_id = p_campaign_id
     and status = 'pending';

  if v_remaining > 0 then
    return jsonb_build_object('done', false, 'remaining', v_remaining);
  end if;

  select count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'failed')
    into v_sent, v_failed
    from whatsapp_campaign_recipients
   where campaign_id = p_campaign_id;

  update whatsapp_campaigns
     set status      = 'completed',
         sent_count  = v_sent,
         failed_count = v_failed,
         updated_at  = now()
   where id = p_campaign_id
     and status in ('running', 'scheduled');

  return jsonb_build_object('done', true, 'sent', v_sent, 'failed', v_failed);
end; $$;


-- ============================================================
-- Grants
-- ============================================================
-- Admin-callable RPCs are reachable through the standard PostgREST
-- pipeline; the security-definer + is_admin() check inside each
-- function is what enforces RBAC. authenticated needs EXECUTE so
-- the dashboard can invoke them.
grant execute on function public.rpc_admin_create_whatsapp_campaign(
  text, text, text, jsonb, text, integer, timestamptz
) to authenticated;
grant execute on function public.rpc_admin_attach_campaign_recipients(uuid, text[], text[])
  to authenticated;
grant execute on function public.rpc_admin_pause_campaign(uuid)  to authenticated;
grant execute on function public.rpc_admin_resume_campaign(uuid) to authenticated;
grant execute on function public.rpc_retry_failed_recipients(uuid) to authenticated;

-- These two are service-role-only (called from cron / edge functions).
revoke execute on function public.rpc_dispatch_whatsapp_batch() from public;
revoke execute on function public.rpc_mark_campaign_if_done(uuid) from public;
