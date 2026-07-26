/**
 * wasage-start Edge Function
 *
 * POST { phone, purpose? }
 *
 * Opens a wasage user-initiated WhatsApp verification and returns:
 *   • reference     – the claim ticket the app later presents to
 *                     wasage-complete (keep it secret to this client)
 *   • clickable_url – WhatsApp deep link the user taps to send the token
 *   • qr_url        – QR alternative (web/desktop)
 *
 * Mirrors send-otp's guards: the same phone-uniqueness pre-check and the
 * same per-phone rate limit (shared otp_rate_limits table, so a user
 * can't multiply their budget by mixing providers). If the wasage create
 * call fails, the rate-limit slot is refunded — a verification that never
 * opened must not cost the user a retry.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      WASAGE_* (see _shared/wasage.ts), WASAGE_MESSAGE (optional).
 */

import { CORS, json }                            from "../_shared/cors.ts";
import { serviceClient, userIdFromAuthHeader }   from "../_shared/supabase.ts";
import { normalizeE164 }                         from "../_shared/phone.ts";
import { checkAndIncrement, refundSend }         from "../_shared/rateLimit.ts";
import { createWasageVerification, wasageConfigured, buildCustomWasageClickable } from "../_shared/wasage.ts";

const TTL_MS = 10 * 60 * 1000;

// Wasage sends this back to the sender on their WhatsApp *regardless* of
// whether the number matches what the user typed in the app — the
// mismatch check happens in our webhook after the fact. So the copy has
// to stay honest for both outcomes: it acknowledges receipt, then punts
// the user back to the app which shows either "verified — enjoy" or
// the "wrong number, retry" error inline.
const DEFAULT_MESSAGE =
  "شكراً لك ✅ استلمنا رسالتك. ارجع لتطبيق مطاعم كفر الدوار الآن عشان تكمل التحقق وتقدر تطلب بكل حرية 🍽️";

function newReference(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  try {
    if (!wasageConfigured()) {
      return json({ ok: false, reason: "service_unavailable" }, 503);
    }

    const body  = await req.json().catch(() => ({}));
    const phone = normalizeE164(body?.phone);
    if (!phone) return json({ ok: false, reason: "invalid_phone" }, 400);

    const purpose = body?.purpose === "attach" ? "attach" : "login";

    const svc = serviceClient();

    // Same clash pre-check as send-otp — don't open a verification for a
    // number wasage-complete would refuse for belonging to someone else.
    const callerId = await userIdFromAuthHeader(req);
    let clashQuery = svc
      .from("profiles")
      .select("id")
      .or(
        callerId
          ? `phone.eq.${phone},alternate_phone.eq.${phone}`
          : `alternate_phone.eq.${phone}`,
      )
      .limit(1);
    if (callerId) clashQuery = clashQuery.neq("id", callerId);
    const { data: clash } = await clashQuery.maybeSingle();
    if (clash) return json({ ok: false, reason: "phone_in_use" }, 409);

    const decision = await checkAndIncrement(svc, phone);
    if (!decision.allowed) {
      return json({
        ok: false,
        reason: decision.reason,
        cooldown_until: decision.cooldownUntil,
        sends_remaining_today: decision.sendsRemainingToday,
      }, 429);
    }

    const reference = newReference();
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

    const { error: insertErr } = await svc.from("wasage_verifications").insert({
      reference,
      phone,
      purpose,
      requester_user_id: callerId,
      status: "pending",
      expires_at: expiresAt,
    });
    if (insertErr) return json({ ok: false, error: insertErr.message }, 500);

    const message = Deno.env.get("WASAGE_MESSAGE") ?? DEFAULT_MESSAGE;
    const result  = await createWasageVerification(reference, message);

    if (!result.ok) {
      await svc.from("wasage_verifications")
        .update({ status: "failed", error: result.error ?? "wasage create failed" })
        .eq("reference", reference);
      // The verification never opened — give the rate-limit slot back.
      await refundSend(svc, phone);
      return json({
        ok: false,
        reason: result.reason ?? "send_failed",
        error: result.error,
      }, 502);
    }

    await svc.from("wasage_verifications")
      .update({ wasage_otp: result.otp ?? null })
      .eq("reference", reference);

    await svc.from("whatsapp_send_log").insert({
      phone, purpose: "otp", status: "sent",
    });

    return json({
      ok: true,
      reference,
      clickable_url:             buildCustomWasageClickable(result.clickable, result.otp),
      qr_url:                    result.qr,
      expires_in_seconds:        Math.floor(TTL_MS / 1000),
      sends_remaining_in_window: decision.sendsRemainingInWindow,
      sends_remaining_today:     decision.sendsRemainingToday,
      cooldown_until:            decision.cooldownUntil,
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
