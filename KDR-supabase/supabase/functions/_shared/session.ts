/**
 * Phone → session logic, shared by every function that finishes a phone
 * verification: verify-otp (push code) and wasage-complete (user-initiated
 * WhatsApp). A verified phone
 * always produces the same account and the same session, whichever
 * provider proved ownership.
 *
 * Accounts are keyed on a synthetic `<digits>@phone.kdr.app` email so we
 * never need Supabase's native phone auth (which forces a paid SMS
 * provider). Owners, drivers and admins have real emails and passwords
 * created from the dashboard; the same phone can sign them in too.
 *
 * ── Fixed 2026-11-14 ─────────────────────────────────────────────
 *  1. Signing in used to *reset the account password* to a random value
 *     so it could call signInWithPassword. For a phone-first customer that
 *     was harmless, but an owner or driver who tapped the phone card once
 *     silently lost the password the dashboard gave them. Sessions are now
 *     minted with a server-side magic-link token (generateLink → verifyOtp)
 *     which never touches the password. The old reset path survives only
 *     as a last resort for synthetic accounts, whose password nobody knows.
 *  2. The synthetic-email lookup scanned `listUsers({ perPage: 200 })` —
 *     only the first 200 accounts. It now asks the database directly
 *     (`admin_auth_user_id_by_email`, migration 081, service_role only) and
 *     falls back to paging through every user if that RPC isn't there yet.
 *  3. Changing your phone left the auth email on the *old* number, so
 *     whoever verified that old number next was logged into your account
 *     (a real risk once a carrier recycles the number). Attaching a new
 *     phone now moves the synthetic email along with it, and a stale
 *     synthetic match — an account whose profile has since moved to a
 *     different number — is released instead of signed into.
 */

import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

const SYNTHETIC_EMAIL_DOMAIN = "phone.kdr.app";

export function syntheticEmailFor(phone: string): string {
  return `${phone.replace(/^\+/, "")}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

/** A synthetic address that no longer encodes any phone number. */
function releasedEmailFor(userId: string): string {
  return `released-${userId}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function strongRandomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * auth.users id for an email, or null. Prefers the service-role-only RPC
 * from migration 081; until that is applied, pages through every user
 * rather than stopping at the first page like the old code did.
 */
export async function findAuthUserIdByEmail(
  svc: SupabaseClient,
  email: string,
): Promise<string | null> {
  const wanted = email.toLowerCase();

  const { data, error } = await svc.rpc("admin_auth_user_id_by_email", {
    p_email: wanted,
  });
  if (!error) return (data as string | null) ?? null;

  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data: list, error: listErr } = await svc.auth.admin.listUsers({
      page,
      perPage,
    });
    if (listErr) return null;
    const users = list?.users ?? [];
    const match = users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (match) return match.id;
    if (users.length < perPage) return null;
  }
  return null;
}

/**
 * Points `userId`'s auth email at `email` when it's free; otherwise parks
 * the account on a released address so no phone number maps to it.
 */
async function moveSyntheticEmail(
  svc: SupabaseClient,
  userId: string,
  email: string,
): Promise<void> {
  const holder = await findAuthUserIdByEmail(svc, email);
  if (holder === userId) return;
  const target = holder ? releasedEmailFor(userId) : email;
  await svc.auth.admin.updateUserById(userId, {
    email: target,
    email_confirm: true,
  });
}

export type AttachResult =
  | { ok: true; mode: "attached" }
  | { ok: false; reason: "phone_in_use" };

/**
 * Attach a verified primary phone to an existing account (OAuth
 * complete-profile, checkout phone gate, phone change). Refuses if the
 * number already belongs to someone else — otherwise the unique index on
 * profiles.phone (051) would surface as a 500.
 */
export async function attachPhoneToUser(
  svc: SupabaseClient,
  phone: string,
  userId: string,
): Promise<AttachResult> {
  const { data: clash } = await svc
    .from("profiles")
    .select("id")
    .or(`phone.eq.${phone},alternate_phone.eq.${phone}`)
    .neq("id", userId)
    .limit(1)
    .maybeSingle();
  if (clash) return { ok: false, reason: "phone_in_use" };

  await svc
    .from("profiles")
    .update({ phone, phone_verified_at: new Date().toISOString() })
    .eq("id", userId);

  // A phone-first account's auth email encodes its number. Keep it in step
  // with the new number so the old one stops resolving to this account.
  // Real emails (OAuth, dashboard-created) are left alone.
  const { data: u } = await svc.auth.admin.getUserById(userId);
  const currentEmail = u?.user?.email ?? null;
  const wanted = syntheticEmailFor(phone);
  if (isSyntheticEmail(currentEmail) && currentEmail!.toLowerCase() !== wanted) {
    await moveSyntheticEmail(svc, userId, wanted);
  }

  return { ok: true, mode: "attached" };
}

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
}

export type MintResult =
  | {
      ok: true;
      mode: "signed_in";
      needsOnboarding: boolean;
      session: SessionTokens;
      user: { id?: string; phone: string; email?: string | null };
    }
  | { ok: false; reason?: "phone_in_use"; error?: string };

function anonAuthClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type SessionAttempt =
  // deno-lint-ignore no-explicit-any
  | { ok: true; session: any; user: any }
  | { ok: false; error: string };

/**
 * Mints a session for `email` without changing its password: the admin
 * API issues a magic-link token (no email is sent) and we redeem it.
 */
async function sessionViaMagicLink(
  svc: SupabaseClient,
  email: string,
): Promise<SessionAttempt> {
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return { ok: false, error: linkErr?.message ?? "generateLink returned no token" };
  }

  const anon = anonAuthClient();
  let lastError = "verifyOtp failed";
  // "magiclink" is the type the token was issued as; newer GoTrue builds
  // also accept the unified "email" type for the same token.
  for (const type of ["magiclink", "email"] as const) {
    const { data, error } = await anon.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data?.session) {
      return { ok: true, session: data.session, user: data.user };
    }
    lastError = error?.message ?? lastError;
  }
  return { ok: false, error: lastError };
}

/**
 * The pre-2026-11-14 path: set a random password and sign in with it.
 * Only ever used for synthetic accounts, where no human knows (or needs)
 * the password, so overwriting it costs nothing.
 */
async function sessionViaPasswordReset(
  svc: SupabaseClient,
  userId: string,
  email: string,
): Promise<SessionAttempt> {
  const password = strongRandomPassword();
  const { error: updErr } = await svc.auth.admin.updateUserById(userId, { password });
  if (updErr) return { ok: false, error: updErr.message };
  const { data, error } = await anonAuthClient().auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    return { ok: false, error: error?.message ?? "signInWithPassword failed" };
  }
  return { ok: true, session: data.session, user: data.user };
}

/**
 * Sign in (or create) the account that owns `phone` and mint a session.
 * Enforces the 051/043 uniqueness rules.
 */
export async function mintSessionForPhone(
  svc: SupabaseClient,
  phone: string,
): Promise<MintResult> {
  const syntheticEmail = syntheticEmailFor(phone);
  const nowIso = new Date().toISOString();

  // 1) The account whose profile carries this phone — covers phone-first
  //    accounts and phones attached to a real email account alike.
  const { data: profileMatch } = await svc
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  let userId: string | null = profileMatch?.id ?? null;

  // 2) Else an account still holding this number's synthetic email. If
  //    that account's profile has since moved to a *different* number it
  //    is not this phone's owner any more: release the address and treat
  //    this as a new signup rather than handing over someone's account.
  if (!userId) {
    const candidate = await findAuthUserIdByEmail(svc, syntheticEmail);
    if (candidate) {
      const { data: candProfile } = await svc
        .from("profiles")
        .select("phone")
        .eq("id", candidate)
        .maybeSingle();
      const movedTo = candProfile?.phone as string | null | undefined;
      if (movedTo && movedTo !== phone) {
        await svc.auth.admin.updateUserById(candidate, {
          email: releasedEmailFor(candidate),
          email_confirm: true,
        });
      } else {
        userId = candidate;
      }
    }
  }

  // 3) Brand-new signup guard: refuse if the number is already someone's
  //    ALTERNATE phone (043 uniqueness) — otherwise the new profile write
  //    clashes and leaves a half-created account.
  if (!userId) {
    const { data: altClash } = await svc
      .from("profiles")
      .select("id")
      .eq("alternate_phone", phone)
      .limit(1)
      .maybeSingle();
    if (altClash) return { ok: false, reason: "phone_in_use" };
  }

  let needsOnboarding = false;
  let userEmail: string | null = null;

  if (userId) {
    const { data: u } = await svc.auth.admin.getUserById(userId);
    userEmail = u?.user?.email ?? null;
    if (!userEmail) {
      await svc.auth.admin.updateUserById(userId, {
        email: syntheticEmail, email_confirm: true,
      });
      userEmail = syntheticEmail;
    }
    await svc
      .from("profiles")
      .update({ phone, phone_verified_at: nowIso })
      .eq("id", userId);
  } else {
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email:         syntheticEmail,
      password:      strongRandomPassword(),
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      return { ok: false, error: createErr?.message ?? "createUser failed" };
    }
    userId = created.user.id;
    userEmail = syntheticEmail;
    needsOnboarding = true;
    // handle_new_user created the profiles row; add the verified phone.
    await svc
      .from("profiles")
      .update({ phone, phone_verified_at: nowIso })
      .eq("id", userId);
  }

  let attempt = await sessionViaMagicLink(svc, userEmail!);
  if (!attempt.ok && isSyntheticEmail(userEmail)) {
    attempt = await sessionViaPasswordReset(svc, userId!, userEmail!);
  }
  if (!attempt.ok) {
    return { ok: false, error: attempt.error };
  }

  return {
    ok: true,
    mode: "signed_in",
    needsOnboarding,
    session: {
      access_token:  attempt.session.access_token,
      refresh_token: attempt.session.refresh_token,
      expires_in:    attempt.session.expires_in,
      expires_at:    attempt.session.expires_at,
      token_type:    attempt.session.token_type,
    },
    user: {
      id:    attempt.user?.id ?? userId ?? undefined,
      phone,
      email: attempt.user?.email ?? userEmail,
    },
  };
}
