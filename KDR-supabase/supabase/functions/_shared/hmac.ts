/**
 * HMAC-SHA256 signing for Edge-Function → Railway calls.
 *
 * Both sides share WA_SHARED_SECRET. Every request carries:
 *   X-KDR-Signature : <hex digest of: timestamp + "." + bodyJSON>
 *   X-KDR-Timestamp : <unix seconds>
 *
 * The Railway service rejects anything older than 60 seconds or
 * whose digest doesn't match.
 */

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export interface SignedRequest {
  headers: Record<string, string>;
  body: string;
}

export async function signRequest(payload: unknown): Promise<SignedRequest> {
  const secret = Deno.env.get("WA_SHARED_SECRET");
  if (!secret) throw new Error("WA_SHARED_SECRET not configured");

  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${ts}.${body}`),
  );

  return {
    headers: {
      "Content-Type": "application/json",
      "X-KDR-Signature": bufToHex(sig),
      "X-KDR-Timestamp": ts,
    },
    body,
  };
}

/** POST to the Railway WhatsApp service with an HMAC-signed body. */
export async function callRailway<T = unknown>(
  path: string,
  payload: unknown,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const base = Deno.env.get("WA_SERVICE_URL");
  if (!base) {
    return { ok: false, status: 0, data: null, error: "WA_SERVICE_URL not configured" };
  }

  const { headers, body } = await signRequest(payload);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: T | null = null;
    try { data = text ? JSON.parse(text) as T : null; } catch { /* keep null */ }
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? undefined : (text || res.statusText),
    };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}
