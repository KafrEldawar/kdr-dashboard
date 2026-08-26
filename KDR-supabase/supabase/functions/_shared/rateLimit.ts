/**
 * Rate-limit logic for OTP issuance, backed by otp_rate_limits.
 *
 * Rules:
 *   • A "window" is the 10-minute rolling window that gates the
 *     short-burst send count. After MAX_SENDS_PER_WINDOW sends inside
 *     one window, the phone is on cooldown for the rest of that window
 *     — but never for less than MIN_COOLDOWN_MS (see below).
 *   • Independently, a 24-hour rolling daily counter hard-caps the
 *     phone at MAX_SENDS_PER_DAY sends per day.
 *
 * The check + increment is done in a single round trip via an upsert
 * that reads the existing row, resets stale counters, and writes the
 * new state. Concurrency: races between two near-simultaneous send
 * attempts can in the worst case let through one extra send — that's
 * acceptable for OTP throttling and avoids a Postgres advisory lock.
 *
 * ── Limits are env-tunable (2026-08-26) ───────────────────────────
 * The daily cap was 6, which is far too tight for the wasage flow:
 * verification there depends on the *user* sending a token from their
 * own WhatsApp, and roughly a third of numbers need several attempts
 * before one lands. A 30-day audit found people burning all 6 in under
 * half an hour and then being locked out for a full 24 hours — the cap
 * was turning a fumbled attempt into a day-long lockout. Raised to 15,
 * with the burst guard bumped 3 → 4.
 *
 * Both are overridable via env so they can be retuned from the
 * dashboard without a redeploy:
 *   OTP_MAX_SENDS_PER_WINDOW   (default 4)
 *   OTP_MAX_SENDS_PER_DAY      (default 15)
 *   OTP_WINDOW_MINUTES         (default 10)
 * Garbage or out-of-range values fall back to the default rather than
 * disabling the limiter — a typo in an env var must never leave OTP
 * issuance wide open.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Read a positive integer from env, clamped to [min, max]. */
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

const WINDOW_MS = envInt("OTP_WINDOW_MINUTES", 10, 1, 120) * 60 * 1000;
const DAILY_MS  = 24 * 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = envInt("OTP_MAX_SENDS_PER_WINDOW", 4, 1, 50);
const MAX_SENDS_PER_DAY    = envInt("OTP_MAX_SENDS_PER_DAY", 15, 1, 200);

/**
 * Floor on a burst cooldown.
 *
 * The cooldown used to be pinned to `window_started_at + WINDOW_MS` —
 * the end of the current window. That is *usually* right, but when the
 * capping send lands near the end of a window the cooldown is born
 * already expired, so the burst guard silently doesn't bite and the
 * only thing left standing between a hammering client and the sender
 * is the daily cap. Clamping to at least this much time from now keeps
 * the original "wait out the window" intent while guaranteeing the
 * cooldown is always a real one.
 */
const MIN_COOLDOWN_MS = 2 * 60 * 1000;

export interface RateLimitDecision {
  allowed: boolean;
  reason?: "cooldown" | "daily_cap";
  cooldownUntil?: string;       // ISO
  sendsRemainingInWindow?: number;
  sendsRemainingToday?: number;
}

interface Row {
  phone: string;
  sends_in_window: number;
  window_started_at: string;
  daily_sends: number;
  daily_started_at: string;
  cooldown_until: string | null;
}

export async function checkAndIncrement(
  svc: SupabaseClient,
  phone: string,
): Promise<RateLimitDecision> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: existing } = await svc
    .from("otp_rate_limits")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  let row: Row;
  if (!existing) {
    row = {
      phone,
      sends_in_window: 0,
      window_started_at: nowIso,
      daily_sends: 0,
      daily_started_at: nowIso,
      cooldown_until: null,
    };
  } else {
    row = existing as Row;
  }

  // Active cooldown?
  if (row.cooldown_until && new Date(row.cooldown_until).getTime() > now) {
    return {
      allowed: false,
      reason: "cooldown",
      cooldownUntil: row.cooldown_until,
      sendsRemainingInWindow: 0,
      sendsRemainingToday: Math.max(0, MAX_SENDS_PER_DAY - row.daily_sends),
    };
  }

  // Roll the window if expired.
  const windowAge = now - new Date(row.window_started_at).getTime();
  if (windowAge >= WINDOW_MS) {
    row.window_started_at = nowIso;
    row.sends_in_window = 0;
    row.cooldown_until = null;
  }

  // Roll the daily counter if expired.
  const dailyAge = now - new Date(row.daily_started_at).getTime();
  if (dailyAge >= DAILY_MS) {
    row.daily_started_at = nowIso;
    row.daily_sends = 0;
  }

  // Daily cap?
  if (row.daily_sends >= MAX_SENDS_PER_DAY) {
    return {
      allowed: false,
      reason: "daily_cap",
      sendsRemainingInWindow: Math.max(0, MAX_SENDS_PER_WINDOW - row.sends_in_window),
      sendsRemainingToday: 0,
    };
  }

  // Increment for this send.
  row.sends_in_window += 1;
  row.daily_sends     += 1;

  // If we just hit the burst cap, sit out the rest of the window — but
  // never less than MIN_COOLDOWN_MS, so a send that caps a nearly-spent
  // window still produces a cooldown that is actually in the future.
  if (row.sends_in_window >= MAX_SENDS_PER_WINDOW) {
    const windowEnds = new Date(row.window_started_at).getTime() + WINDOW_MS;
    row.cooldown_until = new Date(
      Math.max(windowEnds, now + MIN_COOLDOWN_MS),
    ).toISOString();
  }

  await svc.from("otp_rate_limits").upsert({
    phone:             row.phone,
    sends_in_window:   row.sends_in_window,
    window_started_at: row.window_started_at,
    daily_sends:       row.daily_sends,
    daily_started_at:  row.daily_started_at,
    cooldown_until:    row.cooldown_until,
    updated_at:        nowIso,
  });

  return {
    allowed: true,
    sendsRemainingInWindow: Math.max(0, MAX_SENDS_PER_WINDOW - row.sends_in_window),
    sendsRemainingToday:    Math.max(0, MAX_SENDS_PER_DAY    - row.daily_sends),
    cooldownUntil:          row.cooldown_until ?? undefined,
  };
}

/**
 * Undo one checkAndIncrement after a send that never reached WhatsApp
 * (sender offline, daily cap on the sender side, transport error).
 * The user shouldn't lose retry budget — or get locked in a cooldown —
 * for a message that was never delivered.
 */
export async function refundSend(svc: SupabaseClient, phone: string): Promise<void> {
  const { data } = await svc
    .from("otp_rate_limits")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (!data) return;
  const row = data as Row;

  const sendsInWindow = Math.max(0, row.sends_in_window - 1);
  const dailySends    = Math.max(0, row.daily_sends - 1);
  // Lift the cooldown only if it was the refunded send that tripped it.
  const cooldownUntil = sendsInWindow < MAX_SENDS_PER_WINDOW ? null : row.cooldown_until;

  await svc.from("otp_rate_limits").update({
    sends_in_window: sendsInWindow,
    daily_sends:     dailySends,
    cooldown_until:  cooldownUntil,
    updated_at:      new Date().toISOString(),
  }).eq("phone", phone);
}
