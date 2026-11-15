"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { supabase } from "@/lib/supabase/client";

/**
 * Admin-only gate for every dashboard page.
 *
 * A session alone is not enough: restaurant owners and drivers sign in with
 * email + password too, and used to land straight in the admin UI. Their
 * data access was still limited by RLS, but they could see the whole admin
 * surface and poke at it. Now the caller's `profiles.role` must be `admin`.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, role, roleLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [session, loading, router]);

  if (loading || (session && roleLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        جاري التحقق من الجلسة…
      </div>
    );
  }

  if (!session) {
    return null;
  }

  if (role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm space-y-4 rounded-2xl border bg-card p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="text-lg font-bold">الحساب ده مالوش صلاحية دخول لوحة التحكم</h1>
          <p className="text-sm text-muted-foreground">
            لوحة التحكم للمشرفين بس. لو المفروض يكون عندك صلاحية، كلّم مسؤول النظام.
          </p>
          <Button
            className="w-full"
            onClick={async () => {
              await supabase?.auth.signOut();
              router.replace("/login");
            }}
          >
            تسجيل الخروج
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
