/**
 * verify-otp Edge Function
 *
 * To avoid Supabase forcing a paid SMS provider (Twilio/etc), we don't
 * use the native phone auth at all. Instead we mint a synthetic email
 * (`<digits>@phone.kdr.app`) per phone number, store the verified phone
 * in profiles, and sign the user in via signInWithPassword({ email }).
 * The end user never sees the email.
 *
 * The account resolution and session minting live in _shared/session.ts
 * (shared with wasage-complete) — this file
 * only checks the code.
 *
 * Uniqueness contract (post-051): a phone number can belong to at most
 * one account, counting both `profiles.phone` and `profiles.alternate_phone`.
 * The migration enforces this at the DB level via a UNIQUE partial index
 * on `profiles.phone`. This function pre-checks the rule so the client
 * gets a friendly `reason: 'phone_in_use'` instead of a 500 from the
 * constraint violation.
 */

import { CORS, json }                from "../_shared/cors.ts";
import { serviceClient, userIdFromAuthHeader } from "../_shared/supabase.ts";
import { normalizeE164 }             from "../_shared/phone.ts";
import { verifyCode }                from "../_shared/otp.ts";
import { attachPhoneToUser, mintSessionForPhone } from "../_shared/session.ts";

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
    // attach a primary phone. The shared helper refuses a phone that is
    // already on another account (primary or alternate) and keeps a
    // phone-first account's synthetic email in step with the new number.
    const existingUserId = await userIdFromAuthHeader(req);
    if (existingUserId) {
      const res = await attachPhoneToUser(svc, phone, existingUserId);
      if (!res.ok) return json({ ok: false, reason: res.reason }, 409);
      return json({ ok: true, mode: "attached" });
    }

    // ── Signup / phone-first sign-in branch ──────────────────────
    // Same account resolution + session minting as wasage-complete
    // (see _shared/session.ts).
    const res = await mintSessionForPhone(svc, phone);
    if (!res.ok) {
      const status = res.reason === "phone_in_use" ? 409 : 500;
      return json({ ok: false, reason: res.reason, error: res.error }, status);
    }

    return json({
      ok: true,
      mode: "signed_in",
      needs_onboarding: res.needsOnboarding,
      session: res.session,
      user: res.user,
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
