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
 *     whatsapp:      { status, latencyMs, detail?, error? }
 *     supabase:      { ... }
 *     edgeFunctions: { ... }
 *   },
 *   summary: { window_minutes, counts, by_source },
 *   events:  SystemEvent[]
 * }
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

async function probeWhatsapp(): Promise<ServiceReport> {
  const url   = process.env.WA_SERVICE_URL;
  const token = process.env.WA_ADMIN_TOKEN;
  if (!url || !token) {
    return { status: "unconfigured", latencyMs: null, error: "WA_SERVICE_URL/WA_ADMIN_TOKEN not set" };
  }
  const t0 = Date.now();
  try {
    const res = await withTimeout(
      fetch(`${url.replace(/\/$/, "")}/session/status`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
      PROBE_TIMEOUT_MS,
      "whatsapp",
    );
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { status: "down", latencyMs, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    const connected = body?.connected === true;
    if (connected) {
      return {
        status: "ok",
        latencyMs,
        detail: `متصل${body?.phone ? ` — ${body.phone}` : ""}`,
      };
    }
    // `paired` distinguishes the two disconnected states: false means
    // the session creds are gone and nothing recovers without an
    // operator scanning a QR (hard down); true means the session is
    // valid and the sender is reconnecting on its own (degraded).
    // Older sender builds don't send the field — keep the legacy label.
    if (body?.paired === false) {
      return {
        status: "down",
        latencyMs,
        detail: "غير مرتبط — يحتاج مسح QR من صفحة واتساب",
      };
    }
    return {
      status: "degraded",
      latencyMs,
      detail: body?.paired === true ? "الجلسة سليمة — بيعيد الاتصال…" : "بانتظار مسح QR",
    };
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
    // OPTIONS to send-otp: proves the edge runtime is up and CORS is
    // configured without firing an actual OTP send. Any 2xx/3xx means
    // the function boot succeeded.
    const res = await withTimeout(
      fetch(`${url.replace(/\/$/, "")}/functions/v1/send-otp`, {
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
    // Read the table directly instead — the /api route itself is the
    // access-control boundary.
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

export async function GET() {
  const [whatsapp, supabase, edgeFunctions, feed] = await Promise.all([
    probeWhatsapp(),
    probeSupabase(),
    probeEdgeFunctions(),
    readEventFeed(),
  ]);

  return NextResponse.json(
    {
      ts:       new Date().toISOString(),
      services: { whatsapp, supabase, edgeFunctions },
      summary:  feed.summary,
      events:   feed.events,
      feedError: feed.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
