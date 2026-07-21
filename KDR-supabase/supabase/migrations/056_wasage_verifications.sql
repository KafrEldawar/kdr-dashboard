-- ============================================================
-- 056: Wasage user-initiated WhatsApp OTP (interim provider)
-- ============================================================
--
-- Interim bridge while Meta Business Verification (Cloud API auth
-- templates) is still pending. Unlike send-otp/verify-otp — which
-- *push* a 6-digit code to the user — wasage runs the verification
-- backwards:
--
--   1. wasage-start  → we ask wasage for a token + a WhatsApp deep link
--   2. the user opens WhatsApp and sends that token to wasage
--   3. wasage-webhook ← wasage calls us back with the verified number
--   4. wasage-complete → the app polls and claims its session
--
-- This table is the state that ties those four steps together. Only
-- the Edge Functions (service role) touch it; RLS is on with no
-- policies, exactly like otp_codes.
--
-- Callback URL to register in the wasage console (Server Callback):
--   https://<project-ref>.supabase.co/functions/v1/wasage-webhook
--
-- Required Edge-Function secrets:
--   WASAGE_USERNAME, WASAGE_PASSWORD, WASAGE_SECRET
--   WASAGE_API_URL   (optional, default https://wasage.com/api/otp/)
--   WASAGE_MESSAGE   (optional, post-verification reply text)
-- ============================================================


-- ── wasage_verifications ──────────────────────────────────────
-- One row per verification attempt. `reference` is a high-entropy
-- server-generated nonce: it is what wasage echoes back in the
-- callback, and it doubles as the claim ticket the app presents to
-- wasage-complete — so it must stay secret to the originating client.
create table if not exists public.wasage_verifications (
  id                 uuid        primary key default gen_random_uuid(),

  reference          text        not null unique,
  phone              text        not null,             -- E.164 the user entered
  purpose            text        not null default 'login'
                                 check (purpose in ('login', 'attach')),
  -- Set only for attach-mode (a logged-in caller attaching a primary
  -- phone). wasage-complete requires the completing Bearer to match.
  requester_user_id  uuid,

  -- The token wasage minted (the code the user sends via WhatsApp).
  -- Kept to cross-check the callback and for audit.
  wasage_otp         text,

  status             text        not null default 'pending'
                                 check (status in (
                                   'pending',    -- created, awaiting the user's WhatsApp message
                                   'verified',   -- callback arrived, number matched
                                   'consumed',   -- session minted / phone attached
                                   'failed',     -- wasage create call failed
                                   'expired',    -- ttl elapsed before verification
                                   'mismatch'    -- user verified from a different number
                                 )),

  -- Populated by the callback.
  verified_mobile    text,                             -- E.164 wasage reported
  client_id          text,
  client_name        text,
  error              text,

  expires_at         timestamptz not null,
  verified_at        timestamptz,
  consumed_at        timestamptz,
  created_at         timestamptz not null default now()
);

-- Callback lookup is by reference (already unique). Poll + housekeeping
-- lookups are by phone/recency and by status.
create index if not exists idx_wasage_verifications_phone_recent
  on public.wasage_verifications (phone, created_at desc);

create index if not exists idx_wasage_verifications_status
  on public.wasage_verifications (status, created_at desc);

alter table public.wasage_verifications enable row level security;
-- No public policies — only service_role (Edge Functions) access.
