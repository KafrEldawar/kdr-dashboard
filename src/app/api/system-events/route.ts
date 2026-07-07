/**
 * Ingest endpoint for cross-service system events.
 *
 * Producers (whatsapp-sender on Railway, edge functions, etc.) POST here
 * with a shared bearer token. We proxy into Supabase via the service
 * role — this keeps SUPABASE_SERVICE_ROLE_KEY inside the dashboard
 * environment and out of Railway/edge, where key rotation is harder.
 *
 * Required env (server-only):
 *   SYSTEM_EVENTS_TOKEN     shared secret (long random hex)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Request:
 *   POST /api/system-events
 *   Authorization: Bearer <SYSTEM_EVENTS_TOKEN>
 *   Content-Type: application/json
 *   {
 *     source:   "whatsapp-sender",
 *     severity: "warn" | "info" | "error",
 *     event:    "connection_replaced",
 *     message?: "…free-form Arabic/English…",
 *     context?: { ... any JSON … }
 *   }
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Payload = {
  source?:   string;
  severity?: "info" | "warn" | "error";
  event?:    string;
  message?:  string;
  context?:  Record<string, unknown>;
};

export async function POST(request: Request) {
  const expected = process.env.SYSTEM_EVENTS_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "SYSTEM_EVENTS_TOKEN not configured" },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { source, severity, event, message, context } = body;
  if (!source || !event || !severity) {
    return NextResponse.json(
      { error: "source, event, severity required" },
      { status: 400 },
    );
  }
  if (severity !== "info" && severity !== "warn" && severity !== "error") {
    return NextResponse.json(
      { error: "severity must be info|warn|error" },
      { status: 400 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 },
    );
  }

  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.rpc("rpc_log_system_event", {
      p_source:   source,
      p_severity: severity,
      p_event:    event,
      p_message:  message ?? null,
      p_context:  context ?? null,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ ok: true, id: data });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
