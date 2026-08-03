"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bell, CheckCircle, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingState } from "@/components/shared/loading-state";
import { toAppError } from "@/lib/errors";
import { adminService } from "@/services/admin";
import { requireSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { OrderingSwitchCard } from "@/modules/settings/ordering-switch-card";

const notifSchema = z.object({
  title_ar: z.string().min(2, "العنوان مطلوب"),
  body_ar: z.string().min(2, "نص الإشعار مطلوب"),
  title_en: z.string().optional(),
  body_en: z.string().optional(),
  target_type: z.string(),
});

type NotifForm = z.infer<typeof notifSchema>;

const TARGET_OPTIONS = [
  { value: "all_customers", label: "كل العملاء" },
  { value: "all_restaurants", label: "كل أصحاب المطاعم" },
  { value: "platform_android", label: "Android فقط" },
  { value: "platform_ios", label: "iOS فقط" },
];

export function SettingsModule() {
  const { user } = useAuth();
  const [jwtOk, setJwtOk] = useState<boolean | null>(null);
  const [checkingJwt, setCheckingJwt] = useState(false);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => adminService.listCampaigns({ pageSize: 5 }),
    retry: false,
  });

  const notifForm = useForm<NotifForm>({
    resolver: zodResolver(notifSchema),
    defaultValues: {
      title_ar: "",
      body_ar: "",
      title_en: "",
      body_en: "",
      target_type: "all_customers",
    },
  });

  const sendNotifMutation = useMutation({
    mutationFn: (v: NotifForm) =>
      adminService.sendNotification({
        titleAr: v.title_ar,
        bodyAr: v.body_ar,
        titleEn: v.title_en,
        bodyEn: v.body_en,
        targetType: v.target_type,
      }),
    onSuccess: (data) => {
      toast.success(`تم إنشاء الحملة — ${data.target_count ?? 0} مستهدف`);
      notifForm.reset();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  async function checkJwtHook() {
    setCheckingJwt(true);
    try {
      const supabase = requireSupabase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("rpc_admin_get_stats");
      setJwtOk(!data?.error);
    } catch {
      setJwtOk(false);
    } finally {
      setCheckingJwt(false);
    }
  }

  return (
    <>
      <PageHeader title="الإعدادات" description="إعدادات لوحة التحكم والإشعارات." />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Kill switch first — it's the thing you come here for in a hurry. */}
        <OrderingSwitchCard />

        {/* Admin account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> حساب المدير
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">البريد الإلكتروني</span>
              <span dir="ltr">{user?.email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">UUID</span>
              <span dir="ltr" className="font-mono text-xs">{user?.id.slice(0, 16)}…</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">آخر دخول</span>
              <span dir="ltr" className="text-xs">
                {user?.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleString("ar-EG")
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* JWT Hook status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> JWT Hook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              يجب تفعيل <code className="bg-muted px-1 rounded text-xs">custom_access_token_hook</code> في
              Supabase → Authentication → Hooks حتى تعمل صلاحيات الأدمن.
            </p>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={checkJwtHook} disabled={checkingJwt}>
                {checkingJwt ? "جاري الفحص…" : "فحص JWT Hook"}
              </Button>
              {jwtOk === true && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" /> يعمل
                </Badge>
              )}
              {jwtOk === false && (
                <Badge variant="destructive">غير مفعّل أو خطأ</Badge>
              )}
            </div>
            {jwtOk === false && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold mb-1">خطوات التفعيل:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>افتح Supabase Dashboard</li>
                  <li>اذهب إلى Authentication → Hooks</li>
                  <li>اختر Custom Access Token</li>
                  <li>اختر <code>public.custom_access_token_hook</code></li>
                  <li>احفظ وأعد تسجيل الدخول</li>
                </ol>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Send notification */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" /> إرسال إشعار
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={notifForm.handleSubmit((v) => sendNotifMutation.mutate(v))}
            >
              <div className="space-y-2">
                <Label>العنوان (ع)</Label>
                <Input {...notifForm.register("title_ar")} placeholder="تنبيه مهم" />
                {notifForm.formState.errors.title_ar && (
                  <p className="text-xs text-destructive">{notifForm.formState.errors.title_ar.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>العنوان (EN)</Label>
                <Input {...notifForm.register("title_en")} dir="ltr" placeholder="Important Alert" />
              </div>
              <div className="space-y-2">
                <Label>نص الإشعار (ع)</Label>
                <Textarea {...notifForm.register("body_ar")} rows={2} placeholder="اكتب الرسالة هنا…" />
                {notifForm.formState.errors.body_ar && (
                  <p className="text-xs text-destructive">{notifForm.formState.errors.body_ar.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>نص الإشعار (EN)</Label>
                <Textarea {...notifForm.register("body_en")} dir="ltr" rows={2} />
              </div>
              <div className="space-y-2">
                <Label>الجمهور المستهدف</Label>
                <Select
                  value={notifForm.watch("target_type")}
                  onValueChange={(v) => notifForm.setValue("target_type", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button className="w-full" disabled={sendNotifMutation.isPending}>
                  {sendNotifMutation.isPending ? "جاري الإرسال…" : "إرسال الإشعار"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Recent campaigns */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">آخر الحملات</CardTitle>
          </CardHeader>
          <CardContent>
            {campaignsQuery.isLoading ? <LoadingState /> : null}
            {campaignsQuery.data?.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا يوجد حملات بعد.</p>
            ) : null}
            <div className="space-y-2">
              {campaignsQuery.data?.data.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded border p-3 text-sm">
                  <div>
                    <p className="font-medium">{c.title_ar}</p>
                    <p className="text-xs text-muted-foreground">{c.target_type}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{c.target_count} مستهدف</span>
                    <Badge variant={c.status === "sent" ? "default" : "secondary"}>
                      {c.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
