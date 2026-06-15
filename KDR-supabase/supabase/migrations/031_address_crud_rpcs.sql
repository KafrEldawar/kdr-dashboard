-- ============================================================
-- 031: User address CRUD RPCs
--   - rpc_list_my_addresses    : returns rows + needs_pin flag
--   - rpc_upsert_my_address    : create or update one row
--   - rpc_delete_my_address    : delete by id
--   - rpc_set_default_address  : transactional default toggle
-- ============================================================

-- ── rpc_list_my_addresses ─────────────────────────────────────
create or replace function public.rpc_list_my_addresses()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id',           a.id,
          'label',        a.label,
          'address_ar',   a.address_ar,
          'address_en',   a.address_en,
          'location_url', a.location_url,
          'lat',          a.lat,
          'lng',          a.lng,
          'address_type', a.address_type,
          'custom_label', a.custom_label,
          'is_default',   a.is_default,
          'needs_pin',    (a.lat is null or a.lng is null),
          'created_at',   a.created_at,
          'updated_at',   a.updated_at
        )
        order by a.is_default desc, a.created_at desc
      )
      from public.user_addresses a
      where a.user_id = v_uid
    ),
    '[]'::jsonb
  );
end; $$;

grant execute on function public.rpc_list_my_addresses() to authenticated;

-- ── rpc_upsert_my_address ─────────────────────────────────────
-- p_id null → INSERT, else UPDATE (only if the row belongs to caller).
-- Single-default invariant is already enforced by the existing trigger
-- enforce_single_default_address (migration 017).
create or replace function public.rpc_upsert_my_address(
  p_id            uuid    default null,
  p_label         text    default null,
  p_address_ar    text    default null,
  p_address_en    text    default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_address_type  text    default 'other',
  p_custom_label  text    default null,
  p_is_default    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  if p_address_ar is null or p_address_ar = '' then
    return jsonb_build_object('error', 'address_ar is required');
  end if;

  if p_address_type not in ('home','work','other') then
    return jsonb_build_object('error', 'Invalid address_type');
  end if;

  if p_id is null then
    insert into public.user_addresses (
      user_id, label, address_ar, address_en, lat, lng,
      address_type, custom_label, is_default
    ) values (
      v_uid,
      coalesce(p_label, case p_address_type
        when 'home' then 'المنزل'
        when 'work' then 'العمل'
        else coalesce(p_custom_label, 'أخرى') end),
      p_address_ar, p_address_en, p_lat, p_lng,
      p_address_type, p_custom_label, coalesce(p_is_default, false)
    )
    returning id into v_id;
  else
    update public.user_addresses set
      label        = coalesce(p_label,        label),
      address_ar   = coalesce(p_address_ar,   address_ar),
      address_en   = coalesce(p_address_en,   address_en),
      lat          = coalesce(p_lat,          lat),
      lng          = coalesce(p_lng,          lng),
      address_type = coalesce(p_address_type, address_type),
      custom_label = p_custom_label,
      is_default   = coalesce(p_is_default,   is_default),
      updated_at   = now()
    where id = p_id and user_id = v_uid
    returning id into v_id;

    if v_id is null then
      return jsonb_build_object('error', 'Address not found or access denied');
    end if;
  end if;

  return (
    select jsonb_build_object(
      'id',           a.id,
      'label',        a.label,
      'address_ar',   a.address_ar,
      'address_en',   a.address_en,
      'location_url', a.location_url,
      'lat',          a.lat,
      'lng',          a.lng,
      'address_type', a.address_type,
      'custom_label', a.custom_label,
      'is_default',   a.is_default,
      'needs_pin',    (a.lat is null or a.lng is null),
      'created_at',   a.created_at,
      'updated_at',   a.updated_at
    )
    from public.user_addresses a where a.id = v_id
  );
end; $$;

grant execute on function public.rpc_upsert_my_address(
  uuid, text, text, text, double precision, double precision, text, text, boolean
) to authenticated;

-- ── rpc_delete_my_address ─────────────────────────────────────
create or replace function public.rpc_delete_my_address(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  delete from public.user_addresses where id = p_id and user_id = v_uid;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    return jsonb_build_object('error', 'Address not found or access denied');
  end if;

  return jsonb_build_object('success', true, 'id', p_id);
end; $$;

grant execute on function public.rpc_delete_my_address(uuid) to authenticated;

-- ── rpc_set_default_address ───────────────────────────────────
-- Toggling is_default=true automatically unsets other defaults
-- thanks to the enforce_single_default_address trigger from 017.
create or replace function public.rpc_set_default_address(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  update public.user_addresses set is_default = true, updated_at = now()
  where id = p_id and user_id = v_uid;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    return jsonb_build_object('error', 'Address not found or access denied');
  end if;

  return jsonb_build_object('success', true, 'id', p_id);
end; $$;

grant execute on function public.rpc_set_default_address(uuid) to authenticated;
