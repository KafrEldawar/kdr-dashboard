-- ============================================================
-- 016: Schema fixes + corrected RPC functions
-- Fixes column mismatches discovered after inspecting real table state:
--   - notification_campaigns: missing status, target_count, error_log, sent_at
--   - vouchers + restaurant_gallery: missing updated_at
--   - device_tokens: uses last_used_at not updated_at
--   - notification_campaigns + user_notifications: column is extra_data not data
-- ============================================================

-- ── Add missing columns ───────────────────────────────────────
alter table public.notification_campaigns
  add column if not exists status       text        not null default 'pending',
  add column if not exists target_count integer     not null default 0,
  add column if not exists error_log    text,
  add column if not exists sent_at      timestamptz;

alter table public.vouchers           add column if not exists updated_at timestamptz not null default now();
alter table public.restaurant_gallery add column if not exists updated_at timestamptz not null default now();

-- ── updated_at triggers for newly-added columns ───────────────
create trigger trg_vouchers_updated_at
  before update on public.vouchers
  for each row execute function public.set_updated_at();

create trigger trg_gallery_updated_at
  before update on public.restaurant_gallery
  for each row execute function public.set_updated_at();

-- ── Fix rpc_register_device_token (last_used_at not updated_at) ─
create or replace function public.rpc_register_device_token(
  p_token    text,
  p_platform text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  insert into device_tokens (user_id, token, platform, is_active)
  values (v_uid, p_token, p_platform::device_platform, true)
  on conflict (token) do update
    set user_id = v_uid, platform = excluded.platform,
        is_active = true, last_used_at = now();

  return jsonb_build_object('success', true, 'token', p_token);
end; $$;

-- ── Fix rpc_get_my_notifications (extra_data not data) ────────
create or replace function public.rpc_get_my_notifications(
  p_page        integer default 1,
  p_page_size   integer default 20,
  p_unread_only boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid    := auth.uid();
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select count(*) into v_total
  from user_notifications
  where user_id = v_uid and (not p_unread_only or is_read = false);

  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) into v_data
  from (
    select id, title, body, image_url, extra_data as data, is_read, created_at
    from user_notifications
    where user_id = v_uid and (not p_unread_only or is_read = false)
    order by created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)),
    'unread_count', (select count(*) from user_notifications where user_id = v_uid and is_read = false)
  );
end; $$;

-- ── Fix rpc_admin_send_notification (extra_data + new columns) ─
create or replace function public.rpc_admin_send_notification(
  p_title_ar      text,
  p_body_ar       text,
  p_title_en      text    default null,
  p_body_en       text    default null,
  p_image_url     text    default null,
  p_target_type   text    default 'all_customers',
  p_target_filter jsonb   default null,
  p_data          jsonb   default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid := auth.uid();
  v_campaign_id  uuid;
  v_target_count bigint := 0;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  case p_target_type
    when 'all_customers' then
      select count(distinct dt.user_id) into v_target_count
      from device_tokens dt join profiles p on p.id = dt.user_id
      where dt.is_active = true and p.role = 'customer';
    when 'all_restaurants' then
      select count(distinct dt.user_id) into v_target_count
      from device_tokens dt join profiles p on p.id = dt.user_id
      where dt.is_active = true and p.role = 'restaurant';
    when 'platform_android' then
      select count(*) into v_target_count from device_tokens where is_active = true and platform = 'android';
    when 'platform_ios' then
      select count(*) into v_target_count from device_tokens where is_active = true and platform = 'ios';
    else v_target_count := 0;
  end case;

  insert into notification_campaigns (
    title_ar, body_ar, title_en, body_en, image_url,
    target_type, target_filter, extra_data,
    sent_by, target_count, status
  ) values (
    p_title_ar, p_body_ar, p_title_en, p_body_en, p_image_url,
    p_target_type::notification_target, p_target_filter, p_data,
    v_uid, v_target_count, 'pending'
  ) returning id into v_campaign_id;

  return jsonb_build_object(
    'campaign_id', v_campaign_id,
    'target_count', v_target_count,
    'status', 'pending',
    'message', 'Campaign created. Call the send-push Edge Function with this campaign_id to dispatch.'
  );
end; $$;

-- ── Fix rpc_admin_list_campaigns ──────────────────────────────
create or replace function public.rpc_admin_list_campaigns(
  p_target_type text    default null,
  p_sent_by     uuid    default null,
  p_page        integer default 1,
  p_page_size   integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from notification_campaigns nc
  where (p_target_type is null or nc.target_type::text = p_target_type)
    and (p_sent_by     is null or nc.sent_by = p_sent_by);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select nc.id, nc.title_ar, nc.title_en, nc.target_type, nc.target_filter,
      nc.target_count, nc.sent_count, nc.failed_count, nc.status,
      nc.created_at, nc.sent_at,
      jsonb_build_object('id', p.id, 'full_name', p.full_name) as sent_by
    from notification_campaigns nc left join profiles p on p.id = nc.sent_by
    where (p_target_type is null or nc.target_type::text = p_target_type)
      and (p_sent_by     is null or nc.sent_by = p_sent_by)
    order by nc.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── Fix rpc_admin_get_campaign ─────────────────────────────────
create or replace function public.rpc_admin_get_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select jsonb_build_object(
    'id', nc.id, 'title_ar', nc.title_ar, 'title_en', nc.title_en,
    'body_ar', nc.body_ar, 'body_en', nc.body_en, 'image_url', nc.image_url,
    'target_type', nc.target_type, 'target_filter', nc.target_filter,
    'data', nc.extra_data,
    'target_count', nc.target_count, 'sent_count', nc.sent_count,
    'failed_count', nc.failed_count, 'status', nc.status,
    'error_log', nc.error_log, 'created_at', nc.created_at, 'sent_at', nc.sent_at,
    'sent_by', jsonb_build_object('id', p.id, 'full_name', p.full_name)
  ) into v_c
  from notification_campaigns nc left join profiles p on p.id = nc.sent_by
  where nc.id = p_campaign_id;

  return coalesce(v_c, jsonb_build_object('error', 'Campaign not found'));
end; $$;
