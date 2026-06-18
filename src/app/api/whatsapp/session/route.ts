/**
 * Server-side proxy to the Railway WhatsApp service.
 *
 * Browser → /api/whatsapp/session?action=status|restart → Railway /session/*
 *
 * Why proxy:
 *   • WA_ADMIN_TOKEN must never reach the browser.
 *   • Avoids CORS round-trip on the WhatsApp page.
 *
 * Required env (server-only):
 *   WA_SERVICE_URL      e.g. https://kdr-whatsapp.up.railway.app
 *   WA_ADMIN_TOKEN      long random hex, matches Railway's WA_ADMIN_TOKEN
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function railwayConfig() {
  const url = process.env.WA_SERVICE_URL;
  const token = process.env.WA_ADMIN_TOKEN;
  if (!url || !token) {
    return { error: "WA_SERVICE_URL/WA_ADMIN_TOKEN not configured" };
  }
  return { url: url.replace(/\/$/, ""), token };
}

export async function GET(request: Request) {
  const cfg = railwayConfig();
  if ("error" in cfg) return NextResponse.json({ error: cfg.error }, { status: 500 });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "status";
  if (action !== "status") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  try {
    const res = await fetch(`${cfg.url}/session/status`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, connected: false },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const cfg = railwayConfig();
  if ("error" in cfg) return NextResponse.json({ error: cfg.error }, { status: 500 });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "restart";
  if (action !== "restart") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  try {
    const res = await fetch(`${cfg.url}/session/restart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
