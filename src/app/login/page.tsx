"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/layout/brand-logo";
import { requireSupabase } from "@/lib/supabase/client";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = requireSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("تم تسجيل الدخول");
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطأ في تسجيل الدخول";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden p-4 sm:p-6">
      {/* Background — soft food gradient fallback */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 12%, hsl(14 90% 92%) 0, transparent 42%), radial-gradient(circle at 85% 88%, hsl(24 95% 90%) 0, transparent 45%), linear-gradient(160deg, #fbf2ed 0%, #f4e8e3 60%, #efe2dd 100%)",
        }}
      />
      {/* Background — user food artwork (single optimized webp; anchored to the food at the bottom) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/login-bg.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center bottom",
          backgroundRepeat: "no-repeat",
        }}
      />
      {/* Legibility scrim behind the card */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-black/5" />

      {/* Login card */}
      <div className="relative w-full max-w-md animate-in-up">
        <div className="rounded-3xl border border-white/50 bg-white/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9 dark:border-white/10 dark:bg-zinc-900/75">
          <div className="flex flex-col items-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/kdr-logo.svg"
              alt="KDR"
              className="h-16 w-16 rounded-full shadow-md ring-2 ring-white/70 dark:ring-white/10"
            />
            <p className="mt-4 text-xs font-bold tracking-wide text-primary">مطاعم كفر الدوار · KDR</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
              تسجيل الدخول
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              ادخل بياناتك للوصول إلى لوحة التحكم
            </p>
          </div>

          <form className="mt-7 space-y-5" onSubmit={handleLogin}>
            <div className="space-y-2">
              <Label className="text-zinc-700 dark:text-zinc-200">البريد الإلكتروني</Label>
              <div className="relative" dir="ltr">
                <Mail className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  className="ps-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-700 dark:text-zinc-200">كلمة المرور</Label>
              <div className="relative" dir="ltr">
                <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  className="ps-10 pe-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  title={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  className="absolute end-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري الدخول...
                </>
              ) : (
                <>
                  دخول
                  <ArrowLeft className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
          © {new Date().getFullYear()} KDR · لوحة إدارة داخلية آمنة
        </p>
      </div>
    </div>
  );
}
