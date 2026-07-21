/**
 * wasage-webhook Edge Function   (PUBLIC — deploy with --no-verify-jwt)
 *
 * Wasage "Server Callback": once the user sends the token from their own
 * WhatsApp, wasage calls this with the verified number.
 *
 *   GET /functions/v1/wasage-webhook
 *       ?OTP=..&Mobile=201279170899&Reference=..&Secret=..
 *       &ClientID=..&ClientName=..
 *
 * The only authenticator wasage provides is the shared Secret echoed in
 * the callback; we constant-time compare it to WASAGE_SECRET. Without
 * this gate anyone could forge a "verified" callback and claim any
 * number. As defense in depth we also require the reported Mobile to
 * equal the number the client entered at wasage-start, and the row is
 * single-use (only the first pending→verified transition sticks).
 *
 * Once the Secret checks out we always answer 200 so wasage doesn't
 * retry; the row status carries the real outcome for wasage-complete.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WASAGE_SECRET.
 */

import { serviceClient } from "../_shared/supabase.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import { secretsMatch }  from "../_shared/wasage.ts";

/** Collect callback params from the query string, or the body on POST. */
async function readParams(req: Request): Promise<URLSearchParams> {
  const q = new URL(req.url).searchParams;
  if ([...q.keys()].length > 0) return q;

  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const j = await req.json();
      return new URLSearchParams(
        Object.entries(j ?? {}).map(([k, v]) => [k, String(v)]),
      );
    }
    const text = await req.text();
    if (text) return new URLSearchParams(text);
  } catch { /* ignore malformed body */ }
  return q;
}

/** Case-insensitive param read — wasage uses Capitalized names. */
function getParam(p: URLSearchParams, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of p.entries()) {
    if (k.toLowerCase() === want) return v;
  }
  return null;
}

Deno.serve(async (req) => {
  const params = await readParams(req);

  const secret   = getParam(params, "Secret") ?? "";
  const expected = Deno.env.get("WASAGE_SECRET") ?? "";
  if (!expected || !secretsMatch(secret, expected)) {
    return new Response("unauthorized", { status: 401 });
  }

  const reference = getParam(params, "Reference");
  const mobileRaw = getParam(params, "Mobile");
  if (!reference || !mobileRaw) {
    return new Response("bad request", { status: 400 });
  }

  const svc = serviceClient();
  const { data: row } = await svc
    .from("wasage_verifications")
    .select("id, phone, status, expires_at")
    .eq("reference", reference)
    .maybeSingle();

  // Unknown reference, or already resolved — ack and do nothing.
  if (!row || row.status !== "pending") {
    return new Response("ok", { status: 200 });
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await svc.from("wasage_verifications").update({ status: "expired" }).eq("id", row.id);
    return new Response("ok", { status: 200 });
  }

  const clientId       = getParam(params, "ClientID");
  const clientName     = getParam(params, "ClientName");
  const verifiedMobile = normalizeE164(mobileRaw);

  // The user must verify from the same number they entered. A mismatch is
  // recorded (not silently accepted) so the app can explain it.
  if (!verifiedMobile || verifiedMobile !== row.phone) {
    await svc.from("wasage_verifications").update({
      status:          "mismatch",
      verified_mobile: verifiedMobile ?? mobileRaw,
      client_id:       clientId,
      client_name:     clientName,
      error:           "verified from a different number",
    }).eq("id", row.id);
    return new Response("ok", { status: 200 });
  }

  await svc.from("wasage_verifications").update({
    status:          "verified",
    verified_mobile: verifiedMobile,
    client_id:       clientId,
    client_name:     clientName,
    verified_at:     new Date().toISOString(),
  }).eq("id", row.id);

  return new Response("ok", { status: 200 });
});
