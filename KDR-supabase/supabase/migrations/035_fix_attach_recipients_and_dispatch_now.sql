-- ============================================================
-- 035: Fix attach_recipients custom_list branch + add send-now
-- ============================================================
-- Bug:
--   The custom_list branch wrapped `unnest()` inside CASE — Postgres
--   disallows set-returning functions in CASE.
-- New:
--   rpc_admin_dispatch_now(campaign_id) — flips a campaign to running,
--   sets every pending recipient's scheduled_for to now(), then nudges
--   the dispatch-campaign-batch Edge Function via pg_net so the user
--   doesn't wait up to 5 min for the cron tick.
-- ============================================================


create or replace function public.rpc_admin_attach_campaign_recipients(
  p_campaign_id uuid,
  p_custom_phones text[] default null,
  p_custom_names  text[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_campaign whatsapp_campaigns;
  v_inserted integer := 0;
  v_total    integer := 0;
  v_has_names boolean;
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

    v_has_names :=
      p_custom_names is not null
      and array_length(p_custom_names, 1) = array_length(p_custom_phones, 1);

    if v_has_names then
      insert into _tmp_wa_targets (phone, name)
      select p.phone, n.name
        from unnest(p_custom_phones) with ordinality as p(phone, idx)
        join unnest(p_custom_names)  with ordinality as n(name,  idx)
          on p.idx = n.idx;
    else
      insert into _tmp_wa_targets (phone, name)
      select phone, null::text
        from unnest(p_custom_phones) as phone;
    end if;
  end if;

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
         status = case when v_total > 0 then 'scheduled' else 'draft' end,
         updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'inserted',    v_inserted,
    'total',       v_total,
    'status',      case when v_total > 0 then 'scheduled' else 'draft' end
  );
end; $$;


create or replace function public.rpc_admin_dispatch_now(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_supa_url   text;
  v_supa_key   text;
  v_updated    integer := 0;
  v_campaign   whatsapp_campaigns;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  select * into v_campaign from whatsapp_campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('error', 'Campaign not found');
  end if;

  if v_campaign.status not in ('draft', 'scheduled', 'paused', 'running') then
    return jsonb_build_object('error',
      format('Campaign is %s - cannot dispatch', v_campaign.status));
  end if;

  update whatsapp_campaign_recipients
     set scheduled_for = now()
   where campaign_id = p_campaign_id
     and status = 'pending'
     and scheduled_for > now();

  get diagnostics v_updated = row_count;

  update whatsapp_campaigns
     set status     = 'running',
         updated_at = now()
   where id = p_campaign_id
     and status in ('scheduled', 'paused', 'draft');

  select value into v_supa_url from app_config where key = 'supabase_url';
  select value into v_supa_key from app_config where key = 'supabase_service_key';

  if v_supa_url is not null and v_supa_key is not null then
    begin
      perform net.http_post(
        url     := v_supa_url || '/functions/v1/dispatch-campaign-batch',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || v_supa_key
        ),
        body    := jsonb_build_object('triggered_by', 'dispatch_now',
                                      'campaign_id',  p_campaign_id)
      );
    exception when others then
      raise warning 'dispatch_now http_post failed: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'ok',          true,
    'campaign_id', p_campaign_id,
    'requeued',    v_updated,
    'status',      'running'
  );
end; $$;

grant execute on function public.rpc_admin_dispatch_now(uuid) to authenticated;
