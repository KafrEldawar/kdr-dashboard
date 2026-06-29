/**
 * verify-otp Edge Function
 *
 * To avoid Supabase forcing a paid SMS provider (Twilio/etc), we don't
 * use the native phone auth at all. Instead we mint a synthetic email
 * (`<digits>@phone.kdr.app`) per phone number, store the verified phone
 * in profiles, and sign the user in via signInWithPassword({ email }).
 * The end user never sees the email.
 *
 * Uniqueness contract (post-051): a phone number can belong to at most
 * one account, counting both `profiles.phone` and `profiles.alternate_phone`.
 * The migration enforces this at the DB level via a UNIQUE partial index
 * on `profiles.phone`. This function pre-checks the rule so the client
 * gets a friendly `reason: 'phone_in_use'` instead of a 500 from the
 * constraint violation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS, json }                from "./_shared/cors.ts";
import { serviceClient, userIdFromAuthHeader } from "./_shared/supabase.ts";
import { normalizeE164 }             from "./_shared/phone.ts";
import { verifyCode }                from "./_shared/otp.ts";

interface OtpRow {
  id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

const SYNTHETIC_EMAIL_DOMAIN = "phone.kdr.app";

function syntheticEmailFor(phone: string): string {
  return `${phone.replace(/^\+/, "")}@${SYNTHETIC_EMAIL_DOMAIN}`;
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

    // ── Attached-mode branch (existing session) ───────────────────
    // OAuth users finish complete-profile then come through here to
    // attach a primary phone. Refuse if the phone is already on
    // another account (primary or alternate) — otherwise the unique
    // index on profiles.phone (added in 051) would surface as a 500.
    const existingUserId = await userIdFromAuthHeader(req);
    if (existingUserId) {
      const { data: clash } = await svc
        .from("profiles")
        .select("id")
        .or(`phone.eq.${phone},alternate_phone.eq.${phone}`)
        .neq("id", existingUserId)
        .limit(1)
        .maybeSingle();
      if (clash) {
        return json({ ok: false, reason: "phone_in_use" }, 409);
      }

      await svc
        .from("profiles")
        .update({ phone, phone_verified_at: new Date().toISOString() })
        .eq("id", existingUserId);
      return json({ ok: true, mode: "attached" });
    }

    // ── Signup / phone-first sign-in branch ──────────────────────
    // Look up an existing auth.user by either the synthetic email or
    // an existing profile with this phone.
    const syntheticEmail = syntheticEmailFor(phone);

    // 1) Try profiles.phone — covers existing users whose phone was
    //    attached to a different (real) email.
    const { data: profileMatch } = await svc
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    let userId: string | null = profileMatch?.id ?? null;
    let userEmail: string | null = null;

    // 2) If still not found, look up by the synthetic email.
    if (!userId) {
      const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
      const m = list?.users?.find((u) => (u.email ?? "").toLowerCase() === syntheticEmail);
      if (m) {
        userId = m.id;
        userEmail = m.email ?? null;
      }
    }

    // 3) Last guard: if no existing user matched the primary phone or
    //    the synthetic email, this would be a brand-new signup. Refuse
    //    if the number is already on someone's profile as their
    //    ALTERNATE phone — otherwise the new user's phone write would
    //    clash with the alternate-phone uniqueness from 043 and leave
    //    a half-created account.
    if (!userId) {
      const { data: altClash } = await svc
        .from("profiles")
        .select("id")
        .eq("alternate_phone", phone)
        .limit(1)
        .maybeSingle();
      if (altClash) {
        return json({ ok: false, reason: "phone_in_use" }, 409);
      }
    }

    let needsOnboarding = false;
    const randomPassword = strongRandomPassword();

    if (userId) {
      // Look up the user's actual email so we know what to sign in with.
      if (!userEmail) {
        const { data: u } = await svc.auth.admin.getUserById(userId);
        userEmail = u?.user?.email ?? null;
      }
      // If for some reason the user has no email at all, give them the
      // synthetic one so signInWithPassword works.
      if (!userEmail) {
        await svc.auth.admin.updateUserById(userId, { email: syntheticEmail, email_confirm: true });
        userEmail = syntheticEmail;
      }
      await svc.auth.admin.updateUserById(userId, { password: randomPassword });
      await svc
        .from("profiles")
        .update({ phone, phone_verified_at: new Date().toISOString() })
        .eq("id", userId);
    } else {
      // Brand-new user.
      const { data: created, error: createErr } = await svc.auth.admin.createUser({
        email:          syntheticEmail,
        password:       randomPassword,
        email_confirm:  true,
      });
      if (createErr || !created?.user) {
        return json({ ok: false, error: createErr?.message ?? "createUser failed" }, 500);
      }
      userId = created.user.id;
      userEmail = syntheticEmail;
      needsOnboarding = true;

      // The handle_new_user trigger writes a profiles row. Add the
      // verified phone on top.
      await svc
        .from("profiles")
        .update({ phone, phone_verified_at: new Date().toISOString() })
        .eq("id", userId);
    }

    // Mint a session via signInWithPassword on the (real or synthetic) email.
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
      return json({ ok: false, error: signinErr?.message ?? "signInWithPassword failed" }, 500);
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
        phone,
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
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
