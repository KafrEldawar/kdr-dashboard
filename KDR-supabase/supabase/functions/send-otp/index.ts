/**
 * send-otp Edge Function
 *
 * POST { phone, purpose? }
 *   purpose: 'login' (default) | 'attach'
 *     'login'  — phone-first signup / primary-phone re-verify (no auth header
 *                needed; verify-otp will mint a session or attach to the
 *                logged-in user's primary phone).
 *     'attach' — logged-in user adding a verified ALTERNATE phone to their
 *                profile; verify-otp writes to profiles.alternate_phone
 *                without minting a session or touching auth.users.
 *
 *   The rate limit is shared per-phone regardless of purpose.
 *
 * Response (success):
 *   { ok: true, sends_remaining_in_window, sends_remaining_today,
 *     expires_in_seconds, cooldown_until? }
 *
 * Response (denied):
 *   { ok: false, reason: 'cooldown'|'daily_cap'|'invalid_phone',
 *     cooldown_until?, sends_remaining_today? }
 *
 * Env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   WA_SHARED_SECRET, WA_SERVICE_URL
 */

import { CORS, json }          from "../_shared/cors.ts";
import { serviceClient }       from "../_shared/supabase.ts";
import { normalizeE164 }       from "../_shared/phone.ts";
import { checkAndIncrement }   from "../_shared/rateLimit.ts";
import { generateCode, hashCode } from "../_shared/otp.ts";
import { callRailway }         from "../_shared/hmac.ts";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizeE164(body?.phone);
    if (!phone) {
      return json({ ok: false, reason: "invalid_phone" }, 400);
    }

    // 'login' is the historical behaviour; 'attach' marks an OTP intended
    // for the alternate-phone attachment flow. Anything unknown is treated
    // as 'login' so old clients keep working.
    const purpose = body?.purpose === "attach" ? "attach" : "login";

    const svc = serviceClient();
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
      purpose,
      expires_at:   expiresAt,
      max_attempts: 5,
    });
    if (insertErr) {
      return json({ ok: false, error: insertErr.message }, 500);
    }

    // Audit row first so we never lose track of an issued code.
    await svc.from("whatsapp_send_log").insert({
      phone, purpose: "otp", status: "queued",
    });

    const railway = await callRailway<{ ok: boolean; provider_message_id?: string }>(
      "/send-otp",
      { phone, code, language: "ar" },
    );

    await svc.from("whatsapp_send_log").insert({
      phone,
      purpose: "otp",
      status: railway.ok ? "sent" : "failed",
      provider_message_id: railway.data?.provider_message_id ?? null,
      error: railway.ok ? null : (railway.error ?? `HTTP ${railway.status}`),
    });

    if (!railway.ok) {
      return json({
        ok: false,
        reason: "send_failed",
        error: railway.error ?? `HTTP ${railway.status}`,
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
