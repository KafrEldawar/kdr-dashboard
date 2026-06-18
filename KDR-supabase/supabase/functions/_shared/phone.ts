/**
 * Normalize a user-supplied phone string to strict E.164.
 * Defaults to +20 (Egypt) when no country code is present and the
 * number looks like a domestic Egyptian mobile (01x…).
 *
 * Returns null on any input that cannot be coerced into a valid
 * E.164 mobile-shaped string. Callers MUST treat null as a 400.
 */
export function normalizeE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw) return null;

  // Strip spaces, dashes, parentheses.
  raw = raw.replace(/[\s\-().]/g, "");

  // Replace leading 00 with +.
  if (raw.startsWith("00")) raw = "+" + raw.slice(2);

  if (raw.startsWith("+")) {
    const digits = raw.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    return "+" + digits;
  }

  // No country code — assume Egypt if it looks like 01xxxxxxxxx.
  if (/^01\d{9}$/.test(raw)) return "+20" + raw.slice(1);

  // Bare digits with no leading 0 → require at least 10 digits and
  // assume the user already included a country code.
  if (/^\d{10,15}$/.test(raw)) return "+" + raw;

  return null;
}

/** Mask all but the last 3 digits for UI/logs: "+20*****1234". */
export function maskPhone(e164: string): string {
  if (!e164.startsWith("+") || e164.length < 6) return e164;
  const tail = e164.slice(-3);
  const head = e164.slice(0, 3);
  return `${head}${"*".repeat(Math.max(0, e164.length - 6))}${tail}`;
}
