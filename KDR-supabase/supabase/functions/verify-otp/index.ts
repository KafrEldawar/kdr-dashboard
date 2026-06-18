/**
 * verify-otp Edge Function
 *
 * POST { phone, code }
 *
 * Behaviour depends on the Authorization header:
 *
 *   • Bearer present  (existing logged-in user adding/changing phone)
 *     ─ verify code → set profiles.phone + phone_verified_at
 *     ─ return { ok: true, mode: 'attached' }
 *
 *   • No Bearer      (phone-first signup or returning phone user)
 *     ─ verify code
 *     ─ if a Supabase auth.user with this phone exists, mint a session
 *       and set phone_verified_at on its profile
 *     ─ otherwise call admin.createUser({phone, phone_confirm:true}),
 *       wait for the handle_new_user trigger to write profiles, set
 *       phone_verified_at, mint a session
 *     ─ return { ok: true, mode: 'signed_in', session, needs_onboarding }
 *
 * Sessions are minted via the random-password trick: rotate a strong
 * random password on the auth.user, then call signInWithPassword.
 * The user never sees that password.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS, json }                from "../_shared/cors.ts";
import { serviceClient, userIdFromAuthHeader } from "../_shared/supabase.ts";
import { normalizeE164 }             from "../_shared/phone.ts";
import { verifyCode }                from "../_shared/otp.ts";

interface OtpRow {
  id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  try {
    const body  = await req.json().catch(() => ({}));
    const phone = normalizeE164(body?.phone);
    const code  = typeof body?.code === "string" ? body.code.trim() : "";

    if (!phone)              return json({ ok: false, reason: "invalid_phone" }, 400);
    if (!/^\d{4,8}$/.test(code))
                              return json({ ok: false, reason: "invalid_code"  }, 400);

    const svc = serviceClient();

    // 1) Fetch the latest unconsumed OTP for this phone.
    const { data: otp, error: otpErr } = await svc
      .from("otp_codes")
      .select("id, code_hash, attempts, max_attempts, expires_at, consumed_at")
      .eq("phone", phone)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpErr) return json({ ok: false, error: otpErr.message }, 500);
    if (!otp)   return json({ ok: false, reason: "no_active_code" }, 404);

    const row = otp as OtpRow;

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ ok: false, reason: "expired" }, 410);
    }
    if (row.attempts >= row.max_attempts) {
      return json({ ok: false, reason: "too_many_attempts" }, 429);
    }

    // 2) Compare. Always increment attempts (cheap + makes brute-force
    //    bookkeeping correct even on success).
    const matched = await verifyCode(code, row.code_hash);

    await svc
      .from("otp_codes")
      .update({
        attempts:    row.attempts + 1,
        consumed_at: matched ? new Date().toISOString() : null,
      })
      .eq("id", row.id);

    if (!matched) {
      return json({
        ok: false,
        reason: "wrong_code",
        attempts_remaining: Math.max(0, row.max_attempts - row.attempts - 1),
      }, 401);
    }

    // 3) Attached-mode branch (existing session).
    const existingUserId = await userIdFromAuthHeader(req);
    if (existingUserId) {
      await svc
        .from("profiles")
        .update({
          phone,
          phone_verified_at: new Date().toISOString(),
        })
        .eq("id", existingUserId);

      // Also keep auth.users.phone in sync so future flows see it.
      await svc.auth.admin.updateUserById(existingUserId, { phone });

      return json({ ok: true, mode: "attached" });
    }

    // 4) Signup / phone-first sign-in branch.
    //    Look up an existing auth.user by phone.
    const { data: byPhone, error: lookupErr } = await svc
      .from("auth.users")
      .select("id")
      .eq("phone", phone.replace(/^\+/, ""))      // auth.users.phone stored sans '+'
      .maybeSingle();
    // If the direct table query is blocked by RLS in this project,
    // fall back to listing via the admin API.
    let userId: string | null = lookupErr ? null : (byPhone?.id ?? null);

    if (!userId) {
      // Final fallback — paginate through admin.listUsers filtering by phone.
      // For large user bases this would be heavy, but the typical case is
      // either "row found above" or "user doesn't exist yet".
      const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
      const m = list?.users?.find((u) =>
        (u.phone ?? "").replace(/^\+/, "") === phone.replace(/^\+/, "")
      );
      userId = m?.id ?? null;
    }

    let needsOnboarding = false;
    const randomPassword = strongRandomPassword();

    if (userId) {
      // Existing user → rotate password, refresh phone_verified_at.
      await svc.auth.admin.updateUserById(userId, { password: randomPassword });
      await svc
        .from("profiles")
        .update({ phone, phone_verified_at: new Date().toISOString() })
        .eq("id", userId);
    } else {
      // New user — phone-only.
      const { data: created, error: createErr } = await svc.auth.admin.createUser({
        phone,
        password:       randomPassword,
        phone_confirm:  true,
      });
      if (createErr || !created?.user) {
        return json({
          ok: false,
          error: createErr?.message ?? "createUser failed",
        }, 500);
      }
      userId = created.user.id;
      needsOnboarding = true;

      // The handle_new_user trigger writes a profiles row. Add the verified
      // timestamp + phone (the trigger may not have phone columns mapped).
      await svc
        .from("profiles")
        .update({ phone, phone_verified_at: new Date().toISOString() })
        .eq("id", userId);
    }

    // 5) Mint a session via signInWithPassword. We use a fresh client
    //    with the anon key so the resulting session object includes the
    //    refresh token, which the service-role client wouldn't issue.
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signin, error: signinErr } = await anonClient.auth.signInWithPassword({
      phone,
      password: randomPassword,
    });
    if (signinErr || !signin?.session) {
      return json({
        ok: false,
        error: signinErr?.message ?? "signInWithPassword failed",
      }, 500);
    }

    return json({
      ok: true,
      mode: "signed_in",
      needs_onboarding: needsOnboarding,
      session: {
        access_token:  signin.session.access_token,
        refresh_token: signin.session.refresh_token,
        expires_in:    signin.session.expires_in,
        expires_at:    signin.session.expires_at,
        token_type:    signin.session.token_type,
      },
      user: {
        id:    signin.user?.id,
        phone: signin.user?.phone,
        email: signin.user?.email,
      },
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function strongRandomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url, length 43 — plenty of entropy, safe for any password rule.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
