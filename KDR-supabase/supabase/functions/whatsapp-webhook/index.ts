/**
 * whatsapp-webhook Edge Function
 *
 * Callback endpoint for the Meta WhatsApp Cloud API.
 *
 *   GET  – subscription handshake: echoes hub.challenge when
 *          hub.verify_token matches WHATSAPP_WEBHOOK_VERIFY_TOKEN.
 *   POST – event delivery. `statuses` events update the matching
 *          whatsapp_send_log row (by provider_message_id / wamid);
 *          inbound `messages` are acknowledged and ignored — the
 *          platform only sends, it doesn't converse.
 *
 * When WHATSAPP_APP_SECRET is set, POSTs must carry a valid
 * X-Hub-Signature-256 (HMAC-SHA256 of the raw body). Until the secret
 * is configured events are accepted unverified so the Meta setup flow
 * isn't blocked on ordering.
 *
 * Deployed with verify_jwt=false: Meta calls this unauthenticated —
 * the verify-token and signature checks above ARE the auth.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *           WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET
 */

import { serviceClient } from "./_shared/supabase.ts";

// Later stages must not overwrite earlier terminal info out of order:
// a late "delivered" must not clobber "read"; "failed" always wins.
const STATUS_RANK: Record<string, number> = {
  queued: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 9,
};

async function validSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret) return true; // not configured yet — accept, see header note

  const header = req.headers.get("X-Hub-Signature-256") ?? "";
  if (!header.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(rawBody),
  );
  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return header.slice(7) === hex;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- Meta subscription handshake -----------------------------------
  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const expected  = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

    if (mode === "subscribe" && expected && token === expected) {
      return new Response(challenge, {
        status: 200, headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // --- Event delivery -------------------------------------------------
  const rawBody = await req.text();
  if (!(await validSignature(req, rawBody))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // deno-lint-ignore no-explicit-any
  let body: any = null;
  try { body = JSON.parse(rawBody); } catch { /* keep null */ }

  // Always 200 from here on — non-2xx makes Meta retry (and eventually
  // pause the subscription); a lost status update is the lesser evil.
  try {
    const svc = serviceClient();

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const statuses = change?.value?.statuses ?? [];
        for (const s of statuses) {
          const wamid  = s?.id;
          const status = s?.status;
          if (!wamid || !(status in STATUS_RANK)) continue;

          const { data: row } = await svc
            .from("whatsapp_send_log")
            .select("id, status")
            .eq("provider_message_id", wamid)
            .maybeSingle();
          if (!row) continue;

          const currentRank = STATUS_RANK[row.status] ?? 0;
          if (STATUS_RANK[status] <= currentRank) continue;

          const err = s?.errors?.[0];
          await svc.from("whatsapp_send_log").update({
            status,
            error: err
              ? `${err.code}: ${err.title ?? err.message ?? ""}${err.error_data?.details ? ` — ${err.error_data.details}` : ""}`
              : null,
          }).eq("id", row.id);
        }
        // change.field === "messages" (inbound) intentionally ignored.
      }
    }
  } catch (err) {
    console.error("whatsapp-webhook processing error:", (err as Error).message);
  }

  return new Response("ok", { status: 200 });
});
