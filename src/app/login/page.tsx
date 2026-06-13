"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden brand-gradient lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5) 0, transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.4) 0, transparent 35%)",
          }}
        />
        <div className="relative flex items-center gap-3 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kdr-logo.svg" alt="KDR" className="h-12 w-12 rounded-full ring-2 ring-white/40" />
          <div className="leading-none">
            <p className="text-xl font-extrabold">KDR</p>
            <p className="mt-1 text-sm text-white/80">مطاعم كفر الدوار</p>
          </div>
        </div>

        <div className="relative text-white">
          <h2 className="max-w-md text-3xl font-extrabold leading-snug">
            لوحة تحكم متكاملة لإدارة المطاعم والطلبات والمستخدمين
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85">
            تابع المطاعم، الفروع، الطلبات، التقارير المالية والتحليلات من مكان واحد — بسرعة وأمان.
          </p>
          <div className="mt-8 flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold backdrop-blur w-fit">
            <ShieldCheck className="h-4 w-4" />
            نظام داخلي آمن
          </div>
        </div>

        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} KDR — جميع الحقوق محفوظة</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm animate-in-up">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <BrandLogo size={56} />
            <h1 className="mt-4 text-xl font-extrabold">مطاعم كفر الدوار</h1>
          </div>

          <div className="mb-6 hidden lg:block">
            <h1 className="text-2xl font-extrabold tracking-tight">تسجيل الدخول</h1>
            <p className="mt-1 text-sm text-muted-foreground">ادخل بياناتك للوصول إلى لوحة التحكم</p>
          </div>

          <form className="space-y-4" onSubmit={handleLogin}>
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور</Label>
              <Input
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
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

          <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            <p className="mb-2 font-bold text-foreground">إعداد أول أدمن:</p>
            <ol className="list-inside list-decimal space-y-1.5">
              <li>سجّل حساب جديد أولاً من صفحة المستخدمين</li>
              <li>افتح Supabase → SQL Editor</li>
              <li>
                نفّذ:{" "}
                <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px]">
                  update public.profiles set role = &apos;admin&apos; where id = &apos;YOUR_UUID&apos;;
                </code>
              </li>
              <li>فعّل JWT Hook من Authentication → Hooks</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
