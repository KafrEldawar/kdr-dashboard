/**
 * wasage-complete Edge Function
 *
 * POST { reference }   (+ Bearer for attach-mode)
 *
 * The app polls this after sending the user into WhatsApp. It reports
 * `pending` (200) until wasage-webhook flips the row to `verified`, then
 * atomically claims the row (single-use) and mints the session — the
 * response shape matches verify-otp so the app reuses its existing
 * OtpVerifyResult handling.
 *
 * Interim/terminal states surface as non-2xx with a `status`/`reason`:
 *   expired (410), failed (502), mismatch (409), consumed (409).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */

import { CORS, json }                          from "../_shared/cors.ts";
import { serviceClient, userIdFromAuthHeader } from "../_shared/supabase.ts";
import { attachPhoneToUser, mintSessionForPhone } from "../_shared/session.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  try {
    const body      = await req.json().catch(() => ({}));
    const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
    if (!reference) return json({ ok: false, reason: "invalid_reference" }, 400);

    const svc = serviceClient();

    const { data: row } = await svc
      .from("wasage_verifications")
      .select("id, phone, purpose, requester_user_id, status, expires_at, verified_mobile")
      .eq("reference", reference)
      .maybeSingle();

    if (!row) return json({ ok: false, reason: "not_found" }, 404);

    if (row.status === "pending") {
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await svc.from("wasage_verifications").update({ status: "expired" }).eq("id", row.id);
        return json({ ok: false, status: "expired", reason: "expired" }, 410);
      }
      // Still waiting for the user's WhatsApp message — keep polling.
      return json({ ok: false, status: "pending" }, 200);
    }
    if (row.status === "expired")  return json({ ok: false, status: "expired",  reason: "expired" }, 410);
    if (row.status === "failed")   return json({ ok: false, status: "failed",   reason: "send_failed" }, 502);
    if (row.status === "mismatch") {
      return json({
        ok: false, status: "mismatch", reason: "phone_mismatch",
        expected_phone: row.phone, verified_mobile: row.verified_mobile,
      }, 409);
    }
    if (row.status === "consumed") return json({ ok: false, status: "consumed", reason: "already_used" }, 409);

    // status === 'verified' → claim atomically so only one poll mints.
    const { data: locked } = await svc
      .from("wasage_verifications")
      .update({ status: "consumed", consumed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "verified")
      .select("id")
      .maybeSingle();
    if (!locked) {
      return json({ ok: false, status: "consumed", reason: "already_used" }, 409);
    }

    const revert = () =>
      svc.from("wasage_verifications")
        .update({ status: "verified", consumed_at: null })
        .eq("id", row.id);

    // Logged-in caller → attach the phone to their existing account (the
    // OAuth complete-profile, checkout phone gate, and phone-change flows).
    // Mirrors verify-otp: the presence of an authenticated caller — not a
    // purpose string — selects attach over minting a new session. Only the
    // caller who started the flow may finish it.
    if (row.requester_user_id) {
      const callerId = await userIdFromAuthHeader(req);
      if (!callerId || callerId !== row.requester_user_id) {
        await revert();
        return json({ ok: false, reason: "forbidden" }, 403);
      }
      const res = await attachPhoneToUser(svc, row.phone, callerId);
      if (!res.ok) {
        await revert();
        return json({ ok: false, reason: res.reason }, 409);
      }
      return json({ ok: true, mode: "attached" });
    }

    // Login-mode: sign in (or create) the account for this phone.
    const res = await mintSessionForPhone(svc, row.phone);
    if (!res.ok) {
      await revert();
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
