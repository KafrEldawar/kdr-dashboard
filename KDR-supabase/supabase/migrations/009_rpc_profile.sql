-- ============================================================
-- 009: Auth + Profile RPC Functions (IsAuthenticated)
-- ============================================================

-- ── rpc_get_my_profile ────────────────────────────────────────
create or replace function public.rpc_get_my_profile()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_p    jsonb;
  v_rest jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  select to_jsonb(p) into v_p from profiles p where p.id = v_uid;

  if (v_p->>'role') = 'restaurant' then
    select jsonb_build_object(
      'id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'logo_url', r.logo_url, 'cover_url', r.cover_url,
      'is_accepting_orders', r.is_accepting_orders,
      'accepts_online_orders', r.accepts_online_orders,
      'estimated_delivery_time', r.estimated_delivery_time
    ) into v_rest
    from restaurant_owners ro join restaurants r on r.id = ro.restaurant_id
    where ro.user_id = v_uid;
    v_p := v_p || jsonb_build_object('restaurant', v_rest);
  end if;

  return v_p;
end; $$;

-- ── rpc_update_profile ────────────────────────────────────────
create or replace function public.rpc_update_profile(
  p_full_name  text default null,
  p_phone      text default null,
  p_gender     text default null,
  p_avatar_url text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  update profiles set
    full_name  = coalesce(p_full_name,  full_name),
    phone      = coalesce(p_phone,      phone),
    gender     = case when p_gender is not null then p_gender::gender_type else gender end,
    avatar_url = coalesce(p_avatar_url, avatar_url),
    updated_at = now()
  where id = v_uid;

  return public.rpc_get_my_profile();
end; $$;

-- ── rpc_get_my_notifications ──────────────────────────────────
create or replace function public.rpc_get_my_notifications(
  p_page      integer default 1,
  p_page_size integer default 20,
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
    select id, title, body, image_url, data, is_read, created_at
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

-- ── rpc_mark_notifications_read ───────────────────────────────
create or replace function public.rpc_mark_notifications_read(
  p_notification_ids uuid[] default null  -- null means mark all
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  update user_notifications set is_read = true
  where user_id = v_uid
    and is_read = false
    and (p_notification_ids is null or id = any(p_notification_ids));

  return jsonb_build_object(
    'success', true,
    'unread_count', (select count(*) from user_notifications where user_id = v_uid and is_read = false)
  );
end; $$;

-- ── rpc_register_device_token ─────────────────────────────────
create or replace function public.rpc_register_device_token(
  p_token    text,
  p_platform text  -- android | ios | web
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
    set user_id = v_uid, platform = excluded.platform, is_active = true, updated_at = now();

  return jsonb_build_object('success', true, 'token', p_token);
end; $$;

-- ── rpc_unregister_device_token ───────────────────────────────
create or replace function public.rpc_unregister_device_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  update device_tokens set is_active = false
  where token = p_token and user_id = v_uid;

  return jsonb_build_object('success', true);
end; $$;
