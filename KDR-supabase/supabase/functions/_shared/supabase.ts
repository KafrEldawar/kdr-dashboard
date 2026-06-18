import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

/** Service-role client — bypasses RLS, used for all admin ops. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * If a Bearer token is present on the incoming request, returns the
 * authenticated user id. Otherwise null. Used by verify-otp to decide
 * between "attach to existing session" vs. "phone-first signup".
 */
export async function userIdFromAuthHeader(
  req: Request,
): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const svc = serviceClient();
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}
