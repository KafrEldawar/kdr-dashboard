"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageCircle, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";

type SessionStatus = {
  connected: boolean;
  phone?: string;
  qr?: string;
  queue?: { size: number; pending: number };
  error?: string;
};

async function fetchStatus(): Promise<SessionStatus> {
  const res = await fetch("/api/whatsapp/session?action=status", { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as SessionStatus;
}

async function restartSession(): Promise<void> {
  const res = await fetch("/api/whatsapp/session?action=restart", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
}

export function WhatsappConnectionModule() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["whatsapp-session-status"],
    queryFn: fetchStatus,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const restartMutation = useMutation({
    mutationFn: restartSession,
    onSuccess: () => {
      toast.success("جاري إعادة تشغيل الجلسة…");
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-session-status"] });
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const status = statusQuery.data;
  const connected = status?.connected === true;

  return (
    <>
      <PageHeader
        icon={MessageCircle}
        title="اتصال واتساب"
        description="امسح كود QR لربط رقم واتساب الخاص بالخدمة. يُستخدم لإرسال رموز OTP والحملات التسويقية."
        action={
          <Button
            variant="outline"
            disabled={restartMutation.isPending}
            onClick={() => restartMutation.mutate()}
          >
            <RefreshCw className="h-4 w-4" />
            {restartMutation.isPending ? "جاري…" : "إعادة الاتصال"}
          </Button>
        }
      />

      {statusQuery.isLoading ? <LoadingState /> : null}
      {statusQuery.isError ? (
        <ErrorState
          description={toAppError(statusQuery.error).message}
          onRetry={() => statusQuery.refetch()}
        />
      ) : null}

      {status ? (
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          {/* Status card */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              {connected ? (
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              ) : (
                <XCircle className="h-10 w-10 text-amber-500" />
              )}
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">حالة الجلسة</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={connected ? "success" : "secondary"}>
                      {connected ? "متصل" : "بانتظار المسح"}
                    </Badge>
                  </div>
                </div>

                {status.phone ? (
                  <div>
                    <p className="text-sm text-muted-foreground">الرقم المرتبط</p>
                    <p dir="ltr" className="mt-1 font-mono text-base font-semibold">
                      {status.phone}
                    </p>
                  </div>
                ) : null}

                {status.queue ? (
                  <div>
                    <p className="text-sm text-muted-foreground">قائمة الإرسال</p>
                    <p className="mt-1 text-sm">
                      {status.queue.pending} قيد التنفيذ، {status.queue.size} في الانتظار
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
              <strong className="text-foreground">ملاحظات أمان:</strong>
              <ul className="mt-2 list-disc space-y-1 pr-5">
                <li>الجلسة محفوظة على القرص في Railway — لا تحتاج إعادة مسح بعد كل نشر.</li>
                <li>إذا انقطع الاتصال نهائياً، أعد التشغيل ثم امسح الكود الجديد.</li>
                <li>لا ترسل دفعات كبيرة بدون cap يومي — يعرّض الرقم للحظر من واتساب.</li>
              </ul>
            </div>
          </div>

          {/* QR card */}
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <p className="text-sm font-semibold">QR Code</p>
            <p className="mt-1 text-xs text-muted-foreground">
              افتح واتساب → الإعدادات → الأجهزة المرتبطة → ربط جهاز
            </p>

            <div className="mx-auto mt-4 flex aspect-square w-full max-w-[260px] items-center justify-center rounded-xl border border-border bg-background">
              {connected ? (
                <div className="flex flex-col items-center gap-2 text-emerald-500">
                  <CheckCircle2 className="h-12 w-12" />
                  <p className="text-sm font-semibold">الجلسة متصلة</p>
                </div>
              ) : status.qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={status.qr}
                  alt="WhatsApp QR Code"
                  className="h-full w-full rounded-lg object-contain p-2"
                />
              ) : (
                <p className="px-4 text-xs text-muted-foreground">
                  جاري توليد الكود… إذا طالت المدة، اضغط "إعادة الاتصال".
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
