/**
 * Wasage user-initiated WhatsApp OTP client.
 *
 * Interim provider while Meta Business Verification is pending. Wasage
 * inverts the usual OTP flow: instead of us pushing a code to the user,
 * we ask wasage for a token + a WhatsApp deep link, the *user* sends
 * that token to wasage from their own WhatsApp, and wasage calls our
 * webhook back with the verified number.
 *
 * Create endpoint (POST, form-encoded — "FromBody"):
 *   POST https://wasage.com/api/otp/
 *     Username, Password, Reference, Message
 *   → { Code:"5500", OTP, QR, Clickable }         on success
 *   → { Code:"5501" }                             on bad credentials
 *
 * Env vars:
 *   WASAGE_USERNAME, WASAGE_PASSWORD  – account credentials
 *   WASAGE_SECRET                     – shared secret echoed in the callback
 *   WASAGE_API_URL                    – default "https://wasage.com/api/otp/"
 */

export function wasageConfigured(): boolean {
  return Boolean(
    Deno.env.get("WASAGE_USERNAME") &&
    Deno.env.get("WASAGE_PASSWORD") &&
    Deno.env.get("WASAGE_SECRET"),
  );
}

export interface WasageCreateResult {
  ok: boolean;
  /** Raw wasage status code, e.g. "5500" / "5501". */
  code?: string;
  /** The token the user will send via WhatsApp. */
  otp?: string | null;
  /** QR image URL (for web/desktop clients). */
  qr?: string | null;
  /** Deep link that opens WhatsApp pre-filled with the token. */
  clickable?: string | null;
  /** App-facing failure bucket — same vocabulary as the push sender. */
  reason?: "auth_failed" | "service_unavailable" | "send_failed";
  error?: string;
}

/** Case-insensitive field read — wasage returns Capitalized keys. */
// deno-lint-ignore no-explicit-any
function pick(obj: any, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const want = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === want) {
      const v = obj[k];
      return v == null ? null : String(v);
    }
  }
  return null;
}

/**
 * Ask wasage to open a verification. Returns the token + links the app
 * needs to send the user into WhatsApp.
 */
export async function createWasageVerification(
  reference: string,
  message: string,
  timeoutMs = 15_000,
): Promise<WasageCreateResult> {
  const username = Deno.env.get("WASAGE_USERNAME");
  const password = Deno.env.get("WASAGE_PASSWORD");
  if (!username || !password) {
    return {
      ok: false, reason: "service_unavailable",
      error: "Wasage not configured",
    };
  }

  const base = Deno.env.get("WASAGE_API_URL") ?? "https://wasage.com/api/otp/";
  // Send credentials in the body (FromBody) rather than the URL so they
  // never land in access logs.
  const form = new URLSearchParams({
    Username:  username,
    Password:  password,
    Reference: reference,
    Message:   message,
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: ctrl.signal,
    });

    const text = await res.text();
    // deno-lint-ignore no-explicit-any
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep null */ }

    const code = pick(data, "Code");

    if (code === "5500") {
      return {
        ok: true,
        code,
        otp:       pick(data, "OTP"),
        qr:        pick(data, "QR"),
        clickable: pick(data, "Clickable"),
      };
    }

    if (code === "5501") {
      return {
        ok: false, code, reason: "auth_failed",
        error: "Invalid wasage username or password",
      };
    }

    // Unknown code, non-2xx, or unparseable body.
    return {
      ok: false,
      code: code ?? undefined,
      reason: res.ok ? "send_failed" : "service_unavailable",
      error: code ? `wasage code ${code}` : (text || `HTTP ${res.status}`),
    };
  } catch (err) {
    return { ok: false, reason: "send_failed", error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Constant-time string compare for the callback Secret. Guards against
 * timing oracles on the shared secret — length is allowed to leak.
 */
export function secretsMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
