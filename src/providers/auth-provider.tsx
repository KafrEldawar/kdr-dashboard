"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  /** True until the first session read has finished. */
  loading: boolean;
  /**
   * `profiles.role` of the signed-in user, or null when signed out / not
   * yet known. The dashboard is admin-only: owners and drivers also have
   * email + password accounts and could otherwise sign in here.
   */
  role: string | null;
  /** True while the role for the current session is being fetched. */
  roleLoading: boolean;
};

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  role: null,
  roleLoading: false,
});

async function fetchRole(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return (data?.role as string | undefined) ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
    role: null,
    roleLoading: false,
  });

  useEffect(() => {
    if (!supabase) {
      setState({ session: null, user: null, loading: false, role: null, roleLoading: false });
      return;
    }

    let cancelled = false;
    let lastUserId: string | null = null;

    const apply = (session: Session | null) => {
      const user = session?.user ?? null;
      const sameUser = user?.id === lastUserId;
      lastUserId = user?.id ?? null;

      setState((prev) => ({
        session,
        user,
        loading: false,
        // Token refreshes re-fire this listener for the same user — keep
        // the known role instead of flashing the guard's loading state.
        role: user && sameUser ? prev.role : null,
        roleLoading: Boolean(user) && !sameUser,
      }));

      if (user && !sameUser) {
        fetchRole(user.id).then((role) => {
          if (cancelled || lastUserId !== user.id) return;
          setState((prev) => ({ ...prev, role, roleLoading: false }));
        });
      }
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => apply(session));

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
