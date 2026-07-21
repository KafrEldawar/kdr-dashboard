/**
 * Phone → session logic, shared by any function that finishes a phone
 * verification. Mirrors the minting/attach branches of verify-otp so a
 * verified phone always produces the same result regardless of which
 * provider (push code vs. wasage user-initiated) proved ownership.
 *
 * NOTE: verify-otp still carries its own inline copy of this logic; the
 * two are intentionally identical. If you change the auth semantics
 * here, change verify-otp too (or fold it onto these helpers).
 */

import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

const SYNTHETIC_EMAIL_DOMAIN = "phone.kdr.app";

export function syntheticEmailFor(phone: string): string {
  return `${phone.replace(/^\+/, "")}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function strongRandomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type AttachResult =
  | { ok: true; mode: "attached" }
  | { ok: false; reason: "phone_in_use" };

/**
 * Attach a verified primary phone to an existing (e.g. OAuth) account.
 * Refuses if the number already belongs to someone else — otherwise the
 * unique index on profiles.phone (051) would surface as a 500.
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

/**
 * Sign in (or create) the account that owns `phone` and mint a session.
 * We avoid Supabase native phone auth (which forces a paid SMS provider)
 * by keying accounts on a synthetic `<digits>@phone.kdr.app` email and
 * signing in with signInWithPassword. Enforces the 051/043 uniqueness
 * rules the same way verify-otp does.
 */
export async function mintSessionForPhone(
  svc: SupabaseClient,
  phone: string,
): Promise<MintResult> {
  const syntheticEmail = syntheticEmailFor(phone);

  // 1) Existing user by profile phone (covers phones attached to a real
  //    email account).
  const { data: profileMatch } = await svc
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  let userId: string | null = profileMatch?.id ?? null;
  let userEmail: string | null = null;

  // 2) Else look up by the synthetic email.
  if (!userId) {
    const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    const m = list?.users?.find((u) => (u.email ?? "").toLowerCase() === syntheticEmail);
    if (m) {
      userId = m.id;
      userEmail = m.email ?? null;
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
  const randomPassword = strongRandomPassword();

  if (userId) {
    if (!userEmail) {
      const { data: u } = await svc.auth.admin.getUserById(userId);
      userEmail = u?.user?.email ?? null;
    }
    if (!userEmail) {
      await svc.auth.admin.updateUserById(userId, {
        email: syntheticEmail, email_confirm: true,
      });
      userEmail = syntheticEmail;
    }
    await svc.auth.admin.updateUserById(userId, { password: randomPassword });
    await svc
      .from("profiles")
      .update({ phone, phone_verified_at: new Date().toISOString() })
      .eq("id", userId);
  } else {
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email:         syntheticEmail,
      password:      randomPassword,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      return { ok: false, error: createErr?.message ?? "createUser failed" };
    }
    userId = created.user.id;
    userEmail = syntheticEmail;
    needsOnboarding = true;
    await svc
      .from("profiles")
      .update({ phone, phone_verified_at: new Date().toISOString() })
      .eq("id", userId);
  }

  // Mint the session by signing in with the (real or synthetic) email.
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: signin, error: signinErr } = await anonClient.auth.signInWithPassword({
    email:    userEmail!,
    password: randomPassword,
  });
  if (signinErr || !signin?.session) {
    return { ok: false, error: signinErr?.message ?? "signInWithPassword failed" };
  }

  return {
    ok: true,
    mode: "signed_in",
    needsOnboarding,
    session: {
      access_token:  signin.session.access_token,
      refresh_token: signin.session.refresh_token,
      expires_in:    signin.session.expires_in,
      expires_at:    signin.session.expires_at,
      token_type:    signin.session.token_type,
    },
    user: {
      id:    signin.user?.id,
      phone,
      email: signin.user?.email,
    },
  };
}
