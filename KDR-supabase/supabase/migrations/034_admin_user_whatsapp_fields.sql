-- ============================================================
-- 034: Surface phone_verified_at + whatsapp_opt_in to admin UI
-- ============================================================
--
-- Extends rpc_admin_list_users to return the new WhatsApp-related
-- profile columns, and rpc_admin_update_user to accept a new
-- p_whatsapp_opt_in flag. Backward compatible — existing callers
-- that don't pass the new arg continue to work.
-- ============================================================


create or replace function public.rpc_admin_list_users(
  p_role      text    default null,
  p_search    text    default null,
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from profiles p
  where (p_role   is null or p.role::text = p_role)
    and (p_search is null or
         p.full_name ilike '%' || p_search || '%' or
         p.phone ilike '%' || p_search || '%');

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select
      p.id, p.full_name, p.phone, p.gender, p.role, p.avatar_url,
      p.is_active, p.created_at,
      p.phone_verified_at,
      coalesce(p.whatsapp_opt_in, true) as whatsapp_opt_in,
      (select jsonb_build_object('id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en)
       from restaurant_owners ro join restaurants r on r.id = ro.restaurant_id
       where ro.user_id = p.id) as restaurant
    from profiles p
    where (p_role   is null or p.role::text = p_role)
      and (p_search is null or
           p.full_name ilike '%' || p_search || '%' or
           p.phone ilike '%' || p_search || '%')
    order by p.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;


create or replace function public.rpc_admin_update_user(
  p_user_id           uuid,
  p_role              text    default null,
  p_is_active         boolean default null,
  p_full_name         text    default null,
  p_phone             text    default null,
  p_whatsapp_opt_in   boolean default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  update profiles set
    role            = case when p_role            is not null then p_role::user_role else role end,
    is_active       = case when p_is_active       is not null then p_is_active       else is_active end,
    whatsapp_opt_in = case when p_whatsapp_opt_in is not null then p_whatsapp_opt_in  else whatsapp_opt_in end,
    full_name       = coalesce(p_full_name, full_name),
    phone           = coalesce(p_phone,     phone),
    updated_at      = now()
  where id = p_user_id;

  insert into audit_logs (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'update', 'profiles', p_user_id::text,
    jsonb_build_object(
      'role',            p_role,
      'is_active',       p_is_active,
      'whatsapp_opt_in', p_whatsapp_opt_in
    ));

  return (select to_jsonb(p) from profiles p where p.id = p_user_id);
end; $$;
