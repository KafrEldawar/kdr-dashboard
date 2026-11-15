import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Access check for the dashboard's own API routes.
 *
 * These routes run with server-only secrets (the Supabase service-role key,
 * the WhatsApp sender's admin token), so they must not answer just anyone
 * who knows the URL. Until 2026-11-14 they had no check at all: anyone
 * could read /api/status's event feed or POST /api/whatsapp/session?action=wipe.
 *
 * The browser sends the signed-in admin's Supabase access token as a Bearer
 * header (see `adminFetch`). We validate it against Supabase Auth and then
 * read the caller's own `profiles.role` *with their token*, so RLS — not
 * this code — decides what they can see. No service-role key is involved
 * in the check itself.
 *
 * Verified against the production project (NEXT_PUBLIC_SUPABASE_URL): the
 * routes it guards report on production too.
 *
 * Returns `null` when the caller is an admin, otherwise the response to send.
 */
export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === header) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await client.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileErr } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr || profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return null;
}
