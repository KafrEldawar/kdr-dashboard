/**
 * Server-side status aggregator for the /status page.
 *
 * Probes the three moving parts of KDR in parallel so the page renders
 * in one round-trip. Every probe caps its own network call at
 * PROBE_TIMEOUT_MS so a single hung dependency can't stall the whole
 * dashboard.
 *
 * Envelope shape (contract with /status page):
 * {
 *   ts: iso,
 *   services: {
 *     otp:           { status, latencyMs, detail?, error? }   (phone-login funnel)
 *     supabase:      { ... }
 *     edgeFunctions: { ... }
 *   },
 *   summary: { window_minutes, counts, by_source },
 *   events:  SystemEvent[]
 * }
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/server/require-admin";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 6_000;

type Status = "ok" | "degraded" | "down" | "unconfigured";

type ServiceReport = {
  status:    Status;
  latencyMs: number | null;
  detail?:   string;
  error?:    string;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Health of phone login — the thing users actually feel.
 *
 * Login runs on wasage's user-initiated WhatsApp flow (the old Railway /
 * Baileys sender is retired), so "is WhatsApp up?" is answered from our
 * own `wasage_verifications` funnel rather than by pinging a sender:
 *
 *   • success   — `verified` / `consumed` (the webhook confirmed the number)
 *   • no reply  — `pending` past its 10-minute TTL, or `expired`: the user
 *                 sent the token and wasage never called back. This is the
 *                 "I sent the code and nothing happened" failure.
 *   • mismatch  — confirmed from a different WhatsApp number than typed
 *   • failed    — wasage refused to open the verification at all
 *
 * Attempts younger than the TTL are still in flight and not counted.
 */
const OTP_TTL_MS = 10 * 60 * 1000;

async function probeOtp(): Promise<ServiceReport> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { status: "unconfigured", latencyMs: null, error: "SUPABASE_SERVICE_ROLE_KEY not set" };
  }
  const t0 = Date.now();
  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const [rowsRes, lastOkRes] = await withTimeout(
      Promise.all([
        client
          .from("wasage_verifications")
          .select("status, created_at")
          .gte("created_at", since24h)
          .limit(10_000),
        client
          .from("wasage_verifications")
          .select("verified_at")
          .in("status", ["verified", "consumed"])
          .order("verified_at", { ascending: false, nullsFirst: false })
          .limit(1),
      ]),
      PROBE_TIMEOUT_MS,
      "otp",
    );
    const latencyMs = Date.now() - t0;
    if (rowsRes.error) {
      return { status: "down", latencyMs, error: rowsRes.error.message };
    }

    type Row = { status: string; created_at: string };
    const settled = ((rowsRes.data ?? []) as Row[]).filter(
      (r) => r.status !== "pending" || now - new Date(r.created_at).getTime() > OTP_TTL_MS,
    );
    const tally = (rows: Row[]) => {
      let ok = 0, noReply = 0, mismatch = 0, failed = 0;
      for (const r of rows) {
        if (r.status === "verified" || r.status === "consumed") ok++;
        else if (r.status === "mismatch") mismatch++;
        else if (r.status === "failed") failed++;
        else noReply++; // pending past TTL, or expired
      }
      return { total: rows.length, ok, noReply, mismatch, failed };
    };
    const day = tally(settled);
    const hour = tally(
      settled.filter((r) => now - new Date(r.created_at).getTime() <= 60 * 60 * 1000),
    );

    const lastOk = (lastOkRes.data?.[0] as { verified_at?: string } | undefined)?.verified_at;
    const lastOkLabel = lastOk
      ? new Date(lastOk).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })
      : "مفيش";
    const rate = day.total ? Math.round((day.ok / day.total) * 100) : null;
    const detail =
      `آخر 24 ساعة: ${day.ok} من ${day.total} أكدوا (${rate ?? "—"}%) · ` +
      `بدون رد من wasage: ${day.noReply} · رقم مختلف: ${day.mismatch}` +
      (day.failed ? ` · فشل الفتح: ${day.failed}` : "") +
      ` · آخر تأكيد ناجح: ${lastOkLabel}`;

    if (hour.failed > 0 && hour.ok === 0) {
      return { status: "down", latencyMs, detail, error: "wasage بيرفض يفتح طلبات تحقق جديدة" };
    }
    if (hour.total >= 3 && hour.ok === 0) {
      return {
        status: "down",
        latencyMs,
        detail,
        error: `محدش قدر يأكد رقمه في آخر ساعة (${hour.total} محاولة) — wasage مش بيرد على الرسائل`,
      };
    }
    if (day.total >= 5 && rate !== null && rate < 50) {
      return { status: "degraded", latencyMs, detail };
    }
    return { status: "ok", latencyMs, detail };
  } catch (err) {
    return { status: "down", latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

async function probeSupabase(): Promise<ServiceReport> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { status: "unconfigured", latencyMs: null, error: "SUPABASE_SERVICE_ROLE_KEY not set" };
  }
  const t0 = Date.now();
  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Head-count the events table itself — proves both the connection
    // pool and this migration's grants are healthy in one probe.
    const result = await withTimeout(
      Promise.resolve(
        client.from("system_events").select("id", { head: true, count: "exact" }),
      ),
      PROBE_TIMEOUT_MS,
      "supabase",
    );
    const latencyMs = Date.now() - t0;
    if (result.error) {
      return { status: "down", latencyMs, error: result.error.message };
    }
    return { status: "ok", latencyMs, detail: "قاعدة البيانات تستجيب" };
  } catch (err) {
    return { status: "down", latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

async function probeEdgeFunctions(): Promise<ServiceReport> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    return { status: "unconfigured", latencyMs: null, error: "NEXT_PUBLIC_SUPABASE_URL not set" };
  }
  const t0 = Date.now();
  try {
    // OPTIONS to wasage-start (the live login entry point): proves the
    // edge runtime is up and CORS is configured without opening a real
    // verification. Any non-5xx means the function booted.
    const res = await withTimeout(
      fetch(`${url.replace(/\/$/, "")}/functions/v1/wasage-start`, {
        method:  "OPTIONS",
        headers: { "Access-Control-Request-Method": "POST" },
      }),
      PROBE_TIMEOUT_MS,
      "edge-functions",
    );
    const latencyMs = Date.now() - t0;
    if (res.status >= 500) {
      return { status: "down", latencyMs, error: `HTTP ${res.status}` };
    }
    // 401/403 counts as "ok" for our purpose — the function booted;
    // we just didn't sign the request.
    return { status: "ok", latencyMs, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { status: "down", latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

async function readEventFeed(): Promise<{
  summary: Record<string, unknown> | null;
  events:  unknown[];
  error?:  string;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { summary: null, events: [], error: "SUPABASE_SERVICE_ROLE_KEY not set" };
  }
  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // We're already server-side under service_role, so the is_admin()
    // guard in the RPCs would fail (service_role has no auth.uid()).
    // Read the table directly instead — the route's requireAdmin() check
    // in GET is the access-control boundary.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const eventsRes = await client
      .from("system_events")
      .select("id, ts, source, severity, event, message, context")
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(100);

    // Build the summary inline from the events we just read — cheaper
    // than a second RPC and keeps the surface small.
    const events = eventsRes.data ?? [];
    const windowStart = Date.now() - 5 * 60 * 1000;
    const inWindow = events.filter(
      (e) => new Date(e.ts as string).getTime() >= windowStart,
    );
    const counts = { info: 0, warn: 0, error: 0 } as Record<string, number>;
    const bySource: Record<string, { errors: number; warns: number; infos: number; last_ts: string }> = {};
    for (const e of inWindow) {
      const sev = e.severity as string;
      counts[sev] = (counts[sev] ?? 0) + 1;
      const src = (e.source as string) ?? "unknown";
      const bucket = bySource[src] ?? { errors: 0, warns: 0, infos: 0, last_ts: e.ts as string };
      if (sev === "error") bucket.errors += 1;
      else if (sev === "warn") bucket.warns += 1;
      else bucket.infos += 1;
      if ((e.ts as string) > bucket.last_ts) bucket.last_ts = e.ts as string;
      bySource[src] = bucket;
    }

    return {
      summary: {
        window_minutes: 5,
        counts,
        by_source: Object.entries(bySource)
          .map(([source, s]) => ({ source, ...s }))
          .sort((a, b) => b.errors - a.errors || b.warns - a.warns),
      },
      events,
    };
  } catch (err) {
    return { summary: null, events: [], error: (err as Error).message };
  }
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const [otp, supabase, edgeFunctions, feed] = await Promise.all([
    probeOtp(),
    probeSupabase(),
    probeEdgeFunctions(),
    readEventFeed(),
  ]);

  return NextResponse.json(
    {
      ts:       new Date().toISOString(),
      services: { otp, supabase, edgeFunctions },
      summary:  feed.summary,
      events:   feed.events,
      feedError: feed.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
