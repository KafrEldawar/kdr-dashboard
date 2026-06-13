import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type SupabaseEnv = "prod" | "dev";
export const ENV_STORAGE_KEY = "kdr-supabase-env";

type EnvConfig = { url: string; key: string };

function readEnvConfig(env: SupabaseEnv): EnvConfig | null {
  const url =
    env === "dev"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL_DEV
      : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env === "dev"
      ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_DEV ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return { url, key };
}

export function isDevEnvAvailable(): boolean {
  return readEnvConfig("dev") !== null;
}

function resolveActiveEnv(): SupabaseEnv {
  if (typeof window === "undefined") return "prod";
  try {
    const stored = window.localStorage.getItem(ENV_STORAGE_KEY);
    if (stored === "dev" && isDevEnvAvailable()) return "dev";
  } catch {
    // localStorage unavailable — fall through
  }
  return "prod";
}

export const activeEnv: SupabaseEnv = resolveActiveEnv();

const activeConfig = readEnvConfig(activeEnv) ?? readEnvConfig("prod");

export const isSupabaseConfigured = activeConfig !== null;

export const supabase = activeConfig
  ? createClient<Database>(activeConfig.url, activeConfig.key, {
      auth: {
        storageKey: `sb-kdr-${activeEnv}-auth`,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase غير متوصل. تأكد من قيم .env.local وشغل السيرفر من جديد.");
  }
  return supabase;
}

export function setActiveEnv(env: SupabaseEnv) {
  if (typeof window === "undefined") return;
  if (env === "dev" && !isDevEnvAvailable()) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL_DEV غير معرَّف. أضفه إلى .env.local وأعد تشغيل السيرفر."
    );
  }
  try {
    window.localStorage.setItem(ENV_STORAGE_KEY, env);
  } catch {
    // ignore
  }
  window.location.reload();
}
