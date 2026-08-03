"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, PlayCircle, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/shared/loading-state";
import { toAppError } from "@/lib/errors";
import { orderingStatusService } from "@/services/settings";

export const ORDERING_STATUS_QUERY_KEY = ["ordering-status"] as const;

const DEFAULT_REASON = "بنواجه مشكلة مؤقتة في التوصيل. هنرجع نستقبل الطلبات قريب.";

/// The one control that stops every restaurant from taking online orders.
///
/// Two-step on purpose: pausing the whole platform is not something anyone
/// should be able to do by brushing a toggle, and the reason typed here is
/// what customers read in the app — so it is a required part of the action,
/// not an afterthought.
export function OrderingSwitchCard() {
  const queryClient = useQueryClient();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [reason, setReason] = useState(DEFAULT_REASON);

  const query = useQuery({
    queryKey: ORDERING_STATUS_QUERY_KEY,
    queryFn: () => orderingStatusService.get(),
  });

  const mutation = useMutation({
    mutationFn: (v: { enabled: boolean; reason?: string }) =>
      orderingStatusService.set(v.enabled, v.reason),
    onSuccess: (data) => {
      queryClient.setQueryData(ORDERING_STATUS_QUERY_KEY, data);
      toast.success(
        data.online_ordering_enabled
          ? "الطلب الأونلاين اشتغل تاني لكل المطاعم"
          : "تم إيقاف الطلب الأونلاين لكل المطاعم"
      );
      setPauseOpen(false);
      setResumeOpen(false);
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  if (query.isLoading) {
    return (
      <Card className="lg:col-span-2">
        <CardContent className="py-6">
          <LoadingState />
        </CardContent>
      </Card>
    );
  }

  const status = query.data;
  const paused = status ? !status.online_ordering_enabled : false;

  return (
    <>
      <Card
        className={
          paused
            ? "lg:col-span-2 border-destructive/40 bg-destructive/5"
            : "lg:col-span-2"
        }
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="h-4 w-4" />
            الطلب الأونلاين (كل المطاعم)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    paused ? "bg-destructive" : "bg-success"
                  }`}
                />
                <span className="font-semibold">
                  {paused ? "متوقف" : "شغّال"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {paused
                  ? "العملاء مش قادرين يطلبوا من أي مطعم دلوقتي."
                  : "كل مطعم بيستقبل الطلبات حسب إعداداته هو."}
              </p>
            </div>

            {paused ? (
              <Button variant="success" onClick={() => setResumeOpen(true)}>
                <PlayCircle className="h-4 w-4" />
                تشغيل الطلب تاني
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => {
                  setReason(DEFAULT_REASON);
                  setPauseOpen(true);
                }}
              >
                <PauseCircle className="h-4 w-4" />
                إيقاف الطلب لكل المطاعم
              </Button>
            )}
          </div>

          {paused && status?.paused_at ? (
            <div className="rounded-lg border border-destructive/30 bg-background p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">
                متوقف من {new Date(status.paused_at).toLocaleString("ar-EG")}
              </p>
              <p className="font-medium">
                {status.paused_reason_ar || "بدون سبب مكتوب"}
              </p>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            الإيقاف ده مؤقت وعام — مش بيغيّر إعدادات أي مطعم لوحده، فلما تشغّله
            تاني كل مطعم بيرجع للحالة اللي هو مختارها. المطعم التجريبي بيفضل
            شغّال علشان تقدر تجرب قبل ما تفتح للعملاء.
          </p>
        </CardContent>
      </Card>

      {/* Pause */}
      <AlertDialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إيقاف الطلب لكل المطاعم؟</AlertDialogTitle>
            <AlertDialogDescription>
              أي عميل هيحاول يطلب هيشوف رسالة إن الطلب متوقف مؤقتاً. الطلبات
              الجارية دلوقتي مش هتتأثر.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="pause-reason">السبب اللي العميل هيقراه</Label>
            <Textarea
              id="pause-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={DEFAULT_REASON}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              إلغاء
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending || reason.trim().length < 5}
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate({ enabled: false, reason: reason.trim() });
              }}
            >
              {mutation.isPending ? "جاري الإيقاف…" : "أوقف الطلب"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resume */}
      <AlertDialog open={resumeOpen} onOpenChange={setResumeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تشغيل الطلب الأونلاين تاني؟</AlertDialogTitle>
            <AlertDialogDescription>
              كل مطعم هيرجع للحالة اللي هو مختارها قبل الإيقاف — مش هنفتح مطعم
              كان قافل نفسه.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              إلغاء
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate({ enabled: true });
              }}
            >
              {mutation.isPending ? "جاري التشغيل…" : "شغّل الطلب"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
