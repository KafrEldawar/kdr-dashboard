"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  MessageCircle,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";

type SessionStatus = {
  connected: boolean;
  phone?: string;
  qr?: string;
  // Mirrors queueStats() in kdr-whatsapp-sender-backend/src/queue.ts:
  // pending is queued+running combined; dailyCount counts only sends
  // that actually reached WhatsApp; warmup = ramp-up cap still active.
  queue?: { pending: number; dailyCount?: number; dailyCap?: number; warmup?: boolean };
  error?: string;
};

async function fetchStatus(): Promise<SessionStatus> {
  const res = await fetch("/api/whatsapp/session?action=status", { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as SessionStatus;
}

async function postAction(action: "restart" | "wipe"): Promise<void> {
  const res = await fetch(`/api/whatsapp/session?action=${action}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
}

export function WhatsappConnectionModule() {
  const queryClient = useQueryClient();
  const [confirmWipe, setConfirmWipe] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["whatsapp-session-status"],
    queryFn: fetchStatus,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const restartMutation = useMutation({
    mutationFn: () => postAction("restart"),
    onSuccess: () => {
      toast.success("جاري إعادة تشغيل الجلسة…");
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-session-status"] });
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const wipeMutation = useMutation({
    mutationFn: () => postAction("wipe"),
    onSuccess: () => {
      toast.success("تم مسح الجلسة. امسح الكود الجديد لربط رقم جديد.");
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-session-status"] });
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const status = statusQuery.data;
  const connected = status?.connected === true;
  const busy = restartMutation.isPending || wipeMutation.isPending;

  return (
    <>
      <PageHeader
        icon={MessageCircle}
        title="اتصال واتساب"
        description="امسح كود QR لربط رقم واتساب الخاص بالخدمة. يُستخدم لإرسال رموز OTP والحملات التسويقية."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => restartMutation.mutate()}
            >
              <RefreshCw className="h-4 w-4" />
              {restartMutation.isPending ? "جاري…" : "إعادة الاتصال"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmWipe(true)}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              مسح الجلسة وربط رقم جديد
            </Button>
          </div>
        }
      />

      <AlertDialog open={confirmWipe} onOpenChange={setConfirmWipe}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>مسح جلسة واتساب الحالية؟</AlertDialogTitle>
            <AlertDialogDescription>
              ده هيمسح بيانات الربط نهائياً ويولّد كود QR جديد عشان تربط رقم
              جديد. الرقم الحالي (إن وجد) هيقع. استخدم هذه الخطوة لو «إعادة
              الاتصال» مش راضي يولّد كود جديد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => wipeMutation.mutate()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              نعم، امسح وابدأ من جديد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                    <p className="mt-1 text-sm">{status.queue.pending} في الانتظار</p>
                  </div>
                ) : null}

                {status.queue?.dailyCap != null ? (
                  <div>
                    <p className="text-sm text-muted-foreground">الرصيد اليومي</p>
                    <p className="mt-1 text-sm">
                      {status.queue.dailyCount ?? 0} من {status.queue.dailyCap} رسالة
                      {status.queue.warmup ? " (فترة تهيئة الرقم)" : ""}
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
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    جاري توليد الكود…
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    لو ما ظهرش الكود خلال 30 ثانية، جرّب «مسح الجلسة وربط رقم
                    جديد» — ده بيمسح بيانات الربط القديمة ويعمل كود نضيف.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
