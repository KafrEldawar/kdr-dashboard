/**
 * send-otp Edge Function
 *
 * POST { phone }
 *
 * Issues a 6-digit WhatsApp OTP. The verify-otp companion completes the
 * flow (either attaches the phone to the logged-in user or mints a
 * session via the synthetic-email scheme — see verify-otp/index.ts).
 *
 * Uniqueness contract (post-051): refuse to spend a WhatsApp send when
 * the number clearly belongs to another account. Rules depend on
 * whether the caller has a Bearer token:
 *   • Bearer present (OAuth complete-profile or alt-phone attach)
 *     → reject if the phone is anyone *else's* primary or alternate.
 *   • No Bearer (phone-first signup/login)
 *     → reject only if the phone is someone's ALTERNATE; being someone
 *       else's primary just means verify-otp will sign them in.
 *
 * Failure semantics (post-2026-07-08 outage): when the WhatsApp sender
 * can't deliver, the per-phone rate-limit increment is refunded — a
 * send that never happened must not eat the user's retry budget — and
 * the response carries a structured `reason` so the app can explain
 * the failure instead of showing a generic error.
 *
 * Provider (2026-07-12 migration): sends go through the official
 * WhatsApp Cloud API once WHATSAPP_ACCESS_TOKEN +
 * WHATSAPP_PHONE_NUMBER_ID are set; until then the legacy
 * Railway/Baileys sender keeps serving. Cutover = set the secrets;
 * rollback = unset them. Remove the Railway path once the sender is
 * decommissioned.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *           WHATSAPP_* (see _shared/whatsapp.ts),
 *           legacy: WA_SHARED_SECRET, WA_SERVICE_URL
 */

import { CORS, json }          from "./_shared/cors.ts";
import { serviceClient, userIdFromAuthHeader } from "./_shared/supabase.ts";
import { normalizeE164 }       from "./_shared/phone.ts";
import { checkAndIncrement, refundSend } from "./_shared/rateLimit.ts";
import { generateCode, hashCode } from "./_shared/otp.ts";
import { callRailway }         from "./_shared/hmac.ts";
import { cloudApiConfigured, sendOtpTemplate } from "./_shared/whatsapp.ts";

const OTP_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizeE164(body?.phone);
    if (!phone) {
      return json({ ok: false, reason: "invalid_phone" }, 400);
    }

    const svc = serviceClient();

    // Early refusal: don't burn a WhatsApp send (or the rate-limit
    // budget) on a number that verify-otp is going to reject for
    // belonging to another account.
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
    if (callerId) {
      clashQuery = clashQuery.neq("id", callerId);
    }
    const { data: clash } = await clashQuery.maybeSingle();
    if (clash) {
      return json({ ok: false, reason: "phone_in_use" }, 409);
    }

    const decision = await checkAndIncrement(svc, phone);
    if (!decision.allowed) {
      return json({
        ok: false,
        reason: decision.reason,
        cooldown_until: decision.cooldownUntil,
        sends_remaining_today: decision.sendsRemainingToday,
      }, 429);
    }

    const code = generateCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

    const { error: insertErr } = await svc.from("otp_codes").insert({
      phone,
      code_hash:    codeHash,
      purpose:      "login",
      expires_at:   expiresAt,
      max_attempts: 5,
    });
    if (insertErr) {
      return json({ ok: false, error: insertErr.message }, 500);
    }

    await svc.from("whatsapp_send_log").insert({
      phone, purpose: "otp", status: "queued",
    });

    let sendOk: boolean;
    let sendReason = "send_failed";
    let sendError: string | null = null;
    let providerMessageId: string | null = null;

    if (cloudApiConfigured()) {
      const result = await sendOtpTemplate(phone, code);
      sendOk            = result.ok;
      sendReason        = result.reason ?? "send_failed";
      sendError         = result.error ?? null;
      providerMessageId = result.providerMessageId;
    } else {
      const railway = await callRailway<{ ok: boolean; error?: string; provider_message_id?: string }>(
        "/send-otp",
        { phone, code, language: "ar" },
      );
      sendOk            = railway.ok;
      sendError         = railway.ok ? null : (railway.error ?? `HTTP ${railway.status}`);
      providerMessageId = railway.data?.provider_message_id ?? null;

      const providerErr = railway.data?.error ?? "";
      sendReason =
        providerErr === "daily_cap_exceeded" ? "service_daily_cap"
        : providerErr === "not_connected"    ? "service_unavailable"
        : "send_failed";
    }

    await svc.from("whatsapp_send_log").insert({
      phone,
      purpose: "otp",
      status: sendOk ? "sent" : "failed",
      provider_message_id: providerMessageId,
      error: sendError,
    });

    if (!sendOk) {
      // The send never reached WhatsApp — give the user their rate-limit
      // slot back so retrying after the outage isn't punished with a 429.
      await refundSend(svc, phone);

      return json({
        ok: false,
        reason: sendReason,
        error: sendError,
      }, 502);
    }

    return json({
      ok: true,
      sends_remaining_in_window: decision.sendsRemainingInWindow,
      sends_remaining_today:     decision.sendsRemainingToday,
      cooldown_until:            decision.cooldownUntil,
      expires_in_seconds:        Math.floor(OTP_TTL_MS / 1000),
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
