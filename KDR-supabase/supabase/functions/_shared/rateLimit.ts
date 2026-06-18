/**
 * Rate-limit logic for OTP issuance, backed by otp_rate_limits.
 *
 * Rules:
 *   • A "window" is the 10-minute rolling window that gates the
 *     short-burst send count. After 3 sends inside one window, the
 *     phone is on cooldown until window_started_at + 10 min.
 *   • Independently, a 24-hour rolling daily counter hard-caps the
 *     phone at 6 sends per day.
 *
 * The check + increment is done in a single round trip via an upsert
 * that reads the existing row, resets stale counters, and writes the
 * new state. Concurrency: races between two near-simultaneous send
 * attempts can in the worst case let through one extra send — that's
 * acceptable for OTP throttling and avoids a Postgres advisory lock.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const WINDOW_MS = 10 * 60 * 1000; // 10 min
const DAILY_MS  = 24 * 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_SENDS_PER_DAY    = 6;

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

  // If we just hit the burst cap, set cooldown for the rest of the window.
  if (row.sends_in_window >= MAX_SENDS_PER_WINDOW) {
    row.cooldown_until = new Date(
      new Date(row.window_started_at).getTime() + WINDOW_MS,
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
