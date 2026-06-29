-- ============================================================
-- 051: Enforce one phone per account, end-to-end.
--
-- A phone number can reach `profiles` from three paths today:
--   1) phone-first OTP (verify-otp edge fn → auth.admin.createUser /
--      updateUserById + profiles.phone)
--   2) OAuth + phone entry (Google/Apple complete-profile → phoneEntry
--      → verify-otp edge fn with an existing session, purpose='login')
--   3) Email+password registration → rpc_update_profile with raw phone
--      typed by the user
--
-- Before this migration:
--   • auth.users.phone is unique (Supabase) — protects path 1 alone.
--   • profiles.phone had a NON-unique index (idx_profiles_phone, 033)
--     → paths 2 and 3 could write a duplicate, leaving auth.users and
--     profiles out of sync.
--   • profiles.alternate_phone is unique (043), but nothing stopped a
--     phone from being one user's primary AND another user's alternate.
--
-- This migration closes all three holes:
--   • Helper: public.normalize_eg_phone(text) → E.164 (+20…). Accepts
--     '01…', '1…', '+201…', '00201…'. Mirrors PhoneUtils.normalizeE164
--     in the Flutter app and _shared/phone.ts in the edge functions
--     so every layer compares the same string.
--   • Drop the old non-unique idx_profiles_phone.
--   • Create a UNIQUE partial index on profiles.phone.
--   • rpc_update_profile now normalizes p_phone and refuses with the
--     stable string 'phone_in_use' if it collides with another
--     account's primary OR alternate phone.
--   • rpc_is_phone_available(text) lets the email+password signup
--     screen reject a taken number BEFORE the auth.user is created
--     (no orphaned email accounts when a phone clashes).
-- ============================================================

-- ── normalize_eg_phone helper ─────────────────────────────────
-- `set search_path = ''` + fully-qualified built-in calls silences the
-- Supabase "Function Search Path Mutable" advisor and prevents a
-- malicious schema from shadowing pg_catalog.
create or replace function public.normalize_eg_phone(p_input text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text;
begin
  if p_input is null then return null; end if;
  v := pg_catalog.regexp_replace(p_input, '[\s\-\(\)\.]', '', 'g');
  if v = '' then return null; end if;

  if pg_catalog.left(v, 1) = '+' then
    v := pg_catalog.substr(v, 2);
  elsif pg_catalog.left(v, 2) = '00' then
    v := pg_catalog.substr(v, 3);
  end if;

  -- Egyptian mobile shortcuts (01[0-2,5]xxxxxxxx → +20…).
  if v ~ '^01[0-25]\d{8}$' then
    v := '20' || pg_catalog.substr(v, 2);
  elsif v ~ '^1[0-25]\d{8}$' then
    v := '20' || v;
  end if;

  if v !~ '^\d{10,15}$' then
    return null;
  end if;

  return '+' || v;
end; $$;

grant execute on function public.normalize_eg_phone(text) to authenticated, anon;


-- ── profiles.phone uniqueness ─────────────────────────────────
drop index if exists public.idx_profiles_phone;

create unique index if not exists idx_profiles_phone_unique
  on public.profiles (phone)
  where phone is not null;


-- ── rpc_is_phone_available ────────────────────────────────────
-- Returns true iff the (normalized) phone is free to attach as a
-- primary number on the caller's account. The caller's own rows are
-- ignored when a session exists — re-entering the same phone is fine.
-- Anon callers (email+password signup pre-check) get a global view.
create or replace function public.rpc_is_phone_available(p_phone text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_norm  text := public.normalize_eg_phone(p_phone);
  v_clash uuid;
begin
  if v_norm is null then return false; end if;
  select id into v_clash
  from public.profiles
  where (phone = v_norm or alternate_phone = v_norm)
    and (v_uid is null or id <> v_uid)
  limit 1;
  return v_clash is null;
end; $$;

grant execute on function public.rpc_is_phone_available(text) to authenticated, anon;


-- ── rpc_update_profile v2 ─────────────────────────────────────
-- Same signature as 009 so the mobile keeps working. New behaviour:
--   • p_phone is normalized via normalize_eg_phone before write.
--   • If the normalized value is in use as anyone else's primary
--     OR alternate, return {"error": "phone_in_use"} so the UI can
--     map it to the Arabic toast.
create or replace function public.rpc_update_profile(
  p_full_name  text default null,
  p_phone      text default null,
  p_gender     text default null,
  p_avatar_url text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_phone_in   text;
  v_phone_e164 text;
  v_clash      uuid;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'Not authenticated');
  end if;

  v_phone_in := nullif(trim(coalesce(p_phone, '')), '');

  if v_phone_in is not null then
    v_phone_e164 := public.normalize_eg_phone(v_phone_in);
    if v_phone_e164 is null then
      return jsonb_build_object('error', 'invalid_phone');
    end if;

    select id into v_clash
    from public.profiles
    where (phone = v_phone_e164 or alternate_phone = v_phone_e164)
      and id <> v_uid
    limit 1;

    if v_clash is not null then
      return jsonb_build_object('error', 'phone_in_use');
    end if;
  end if;

  update profiles set
    full_name  = coalesce(p_full_name,  full_name),
    phone      = case when v_phone_e164 is not null then v_phone_e164 else phone end,
    gender     = case when p_gender is not null then p_gender::gender_type else gender end,
    avatar_url = coalesce(p_avatar_url, avatar_url),
    updated_at = now()
  where id = v_uid;

  return public.rpc_get_my_profile();
end; $$;

grant execute on function public.rpc_update_profile(text, text, text, text) to authenticated;
