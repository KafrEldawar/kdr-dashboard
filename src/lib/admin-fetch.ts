import { supabase } from "@/lib/supabase/client";

/**
 * `fetch` for the dashboard's own `/api/*` routes: attaches the signed-in
 * admin's Supabase access token, which those routes require (see
 * `src/lib/server/require-admin.ts`).
 */
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
