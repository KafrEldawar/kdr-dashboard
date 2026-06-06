-- ============================================================
-- 014: Admin Notification Campaign RPC
-- ============================================================

-- ── rpc_admin_send_notification ───────────────────────────────
-- Creates a campaign record and returns campaign_id.
-- The actual FCM send is handled by the send-push Edge Function (triggered via webhook or direct call).
create or replace function public.rpc_admin_send_notification(
  p_title_ar          text,
  p_body_ar           text,
  p_title_en          text    default null,
  p_body_en           text    default null,
  p_image_url         text    default null,
  p_target_type       text    default 'all_customers',
  p_target_filter     jsonb   default null,
  p_data              jsonb   default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_campaign_id uuid;
  v_target_count bigint := 0;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  -- Count target users (best-effort estimate)
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
      select count(*) into v_target_count from device_tokens
      where is_active = true and platform = 'android';
    when 'platform_ios' then
      select count(*) into v_target_count from device_tokens
      where is_active = true and platform = 'ios';
    else
      v_target_count := 0;
  end case;

  insert into notification_campaigns (
    title_ar, body_ar, title_en, body_en, image_url,
    target_type, target_filter, data,
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

-- ── rpc_admin_list_campaigns ──────────────────────────────────
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
      nc.target_count, nc.sent_count, nc.status,
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

-- ── rpc_admin_get_campaign ────────────────────────────────────
create or replace function public.rpc_admin_get_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select jsonb_build_object(
    'id', nc.id, 'title_ar', nc.title_ar, 'title_en', nc.title_en,
    'body_ar', nc.body_ar, 'body_en', nc.body_en, 'image_url', nc.image_url,
    'target_type', nc.target_type, 'target_filter', nc.target_filter, 'data', nc.data,
    'target_count', nc.target_count, 'sent_count', nc.sent_count,
    'status', nc.status, 'error_log', nc.error_log,
    'created_at', nc.created_at, 'sent_at', nc.sent_at,
    'sent_by', jsonb_build_object('id', p.id, 'full_name', p.full_name)
  ) into v_c
  from notification_campaigns nc left join profiles p on p.id = nc.sent_by
  where nc.id = p_campaign_id;

  return coalesce(v_c, jsonb_build_object('error', 'Campaign not found'));
end; $$;
