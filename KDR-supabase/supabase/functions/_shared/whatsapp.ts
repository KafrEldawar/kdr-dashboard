/**
 * WhatsApp Cloud API (Meta Graph) sender.
 *
 * Replaces the Railway/Baileys sender for OTP delivery: the code goes
 * out as an approved *authentication* template via
 * POST /{phone-number-id}/messages.
 *
 * Env vars:
 *   WHATSAPP_ACCESS_TOKEN     – system-user token with
 *                               whatsapp_business_messaging scope
 *   WHATSAPP_PHONE_NUMBER_ID  – Cloud API phone number id
 *   WHATSAPP_OTP_TEMPLATE     – template name    (default "otp_login")
 *   WHATSAPP_TEMPLATE_LANG    – template language (default "ar")
 *   WHATSAPP_GRAPH_VERSION    – Graph version     (default "v23.0")
 *
 * cloudApiConfigured() lets send-otp keep using the legacy Railway
 * sender until the two required secrets exist — cutover is a secrets
 * change, not a redeploy.
 */

export function cloudApiConfigured(): boolean {
  return Boolean(
    Deno.env.get("WHATSAPP_ACCESS_TOKEN") &&
    Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),
  );
}

export interface CloudSendResult {
  ok: boolean;
  providerMessageId: string | null;
  /** App-facing failure bucket, same vocabulary the Railway path used. */
  reason?: "service_unavailable" | "service_daily_cap" | "send_failed";
  error?: string;
}

// Graph error codes → failure buckets.
// Misconfig (bad token, unregistered number, missing/paused template):
// retrying won't help the user, surface as service_unavailable.
const MISCONFIG_CODES = new Set([190, 133010, 132001, 132012, 132015, 132016]);
// Throughput / spam-quality throttling on the WABA side.
const THROTTLE_CODES  = new Set([130429, 131048, 131056]);

/**
 * Send the OTP authentication template. Authentication templates carry
 * the code twice: once as the body {{1}} and once as the copy-code
 * button parameter — both are required by the API.
 */
export async function sendOtpTemplate(
  phone: string,
  code: string,
  timeoutMs = 15_000,
): Promise<CloudSendResult> {
  const token         = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    return {
      ok: false, providerMessageId: null,
      reason: "service_unavailable", error: "Cloud API not configured",
    };
  }

  const template = Deno.env.get("WHATSAPP_OTP_TEMPLATE")  ?? "otp_login";
  const lang     = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "ar";
  const version  = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone.replace(/^\+/, ""),
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: code }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code }],
        },
      ],
    },
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      },
    );

    const text = await res.text();
    // deno-lint-ignore no-explicit-any
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep null */ }

    if (res.ok) {
      return {
        ok: true,
        providerMessageId: data?.messages?.[0]?.id ?? null,
      };
    }

    const gErr    = data?.error;
    const codeNum = typeof gErr?.code === "number" ? gErr.code : 0;
    const detail  = gErr
      ? `${gErr.code}: ${gErr.message}${gErr.error_data?.details ? ` — ${gErr.error_data.details}` : ""}`
      : (text || `HTTP ${res.status}`);

    return {
      ok: false,
      providerMessageId: null,
      reason: MISCONFIG_CODES.has(codeNum) ? "service_unavailable"
        : THROTTLE_CODES.has(codeNum)      ? "service_daily_cap"
        : "send_failed",
      error: detail,
    };
  } catch (err) {
    return {
      ok: false, providerMessageId: null,
      reason: "send_failed", error: (err as Error).message,
    };
  } finally {
    clearTimeout(t);
  }
}
