/**
 * firebase-phone-complete Edge Function
 *
 * POST { id_token }   (+ Bearer for attach-mode)
 *
 * SMS fallback for phone verification. When a user's WhatsApp message to
 * wasage gets no answer, the app verifies the number with Firebase phone
 * auth (a 6-digit SMS) and sends us the resulting Firebase ID token. We
 * verify that token against Google's keys, read the phone number out of
 * it, and finish exactly like wasage-complete / verify-otp:
 *
 *   • signed-in caller → attach the phone to their account
 *   • otherwise        → sign in (or create) the phone's account and
 *                        return a Supabase session
 *
 * The response shape matches verify-otp, so the app reuses its
 * OtpVerifyResult handling. The phone comes from the verified token,
 * never from the request body.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
 *      FIREBASE_PROJECT_ID.
 */

import { CORS, json }                             from "../_shared/cors.ts";
import { serviceClient, userIdFromAuthHeader }    from "../_shared/supabase.ts";
import { normalizeE164 }                          from "../_shared/phone.ts";
import { attachPhoneToUser, mintSessionForPhone } from "../_shared/session.ts";
import { firebaseConfigured, verifyFirebasePhoneToken } from "../_shared/firebase.ts";

/**
 * Every SMS-fallback completion is worth seeing on /status: a spike means
 * WhatsApp verification is failing for real users. No phone number in the
 * event — the dashboard feed is broader than the data it needs.
 */
async function logFallbackUse(
  svc: ReturnType<typeof serviceClient>,
  mode: "signed_in" | "attached",
): Promise<void> {
  try {
    await svc.from("system_events").insert({
      source:   "otp",
      severity: "info",
      event:    "sms_fallback_completed",
      message:  "تم التحقق من رقم عبر SMS بدل واتساب",
      context:  { mode },
    });
  } catch {
    // Logging must never fail a login.
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  try {
    if (!firebaseConfigured()) {
      return json({ ok: false, reason: "service_unavailable" }, 503);
    }

    const body    = await req.json().catch(() => ({}));
    const idToken = typeof body?.id_token === "string" ? body.id_token.trim() : "";
    if (!idToken) return json({ ok: false, reason: "invalid_token" }, 400);

    const claim = await verifyFirebasePhoneToken(idToken);
    if (!claim.ok) {
      return json({ ok: false, reason: "invalid_token", error: claim.error }, 401);
    }

    // Our phone rules (Egyptian mobile numbers) still apply — Firebase
    // would happily verify any country.
    const phone = normalizeE164(claim.phone);
    if (!phone) return json({ ok: false, reason: "invalid_phone" }, 400);

    const svc = serviceClient();

    const callerId = await userIdFromAuthHeader(req);
    if (callerId) {
      const res = await attachPhoneToUser(svc, phone, callerId);
      if (!res.ok) return json({ ok: false, reason: res.reason }, 409);
      await logFallbackUse(svc, "attached");
      return json({ ok: true, mode: "attached" });
    }

    const res = await mintSessionForPhone(svc, phone);
    if (!res.ok) {
      const status = res.reason === "phone_in_use" ? 409 : 500;
      return json({ ok: false, reason: res.reason, error: res.error }, status);
    }

    await logFallbackUse(svc, "signed_in");
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
