"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useLocale } from "@/lib/i18n";
import {
  campaignsService,
  type CampaignRecipient,
  type RecipientStatus,
} from "@/services/campaigns";
import {
  recipientBadgeVariant,
  recipientStatusLabel,
  statusBadgeVariant,
  statusLabel,
  targetTypeLabel,
} from "./campaign-utils";

const REFRESH_INTERVAL_MS = 8000;

export function CampaignDetailModule({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [recipientFilter, setRecipientFilter] = useState<string>("all");

  const campaignQuery = useQuery({
    queryKey: ["whatsapp-campaign", campaignId],
    queryFn: () => campaignsService.getById(campaignId),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const recipientsQuery = useQuery({
    queryKey: ["whatsapp-campaign-recipients", campaignId, recipientFilter],
    queryFn: () =>
      campaignsService.listRecipients(campaignId, {
        status: recipientFilter === "all" ? undefined : (recipientFilter as RecipientStatus),
        pageSize: 200,
      }),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-campaign", campaignId] });
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-campaign-recipients", campaignId] });
  };

  const pauseMutation = useMutation({
    mutationFn: () => campaignsService.pause(campaignId),
    onSuccess: () => { toast.success("تم إيقاف الحملة"); refresh(); },
    onError: (e) => toast.error(toAppError(e).message),
  });

  const resumeMutation = useMutation({
    mutationFn: () => campaignsService.resume(campaignId),
    onSuccess: () => { toast.success("تم الاستئناف"); refresh(); },
    onError: (e) => toast.error(toAppError(e).message),
  });

  const retryMutation = useMutation({
    mutationFn: () => campaignsService.retryFailed(campaignId),
    onSuccess: (res) => {
      toast.success(`تمت إعادة جدولة ${res.requeued} مستلم`);
      refresh();
    },
    onError: (e) => toast.error(toAppError(e).message),
  });

  const columns = useMemo<ColumnDef<CampaignRecipient>[]>(
    () => [
      {
        accessorKey: "phone",
        header: "الرقم",
        cell: ({ row }) => <span dir="ltr" className="font-mono">{row.original.phone}</span>,
      },
      {
        accessorKey: "name",
        header: "الاسم",
        cell: ({ row }) => row.original.name || "—",
      },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => (
          <Badge variant={recipientBadgeVariant[row.original.status]}>
            {recipientStatusLabel[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: "scheduled_for",
        header: "مجدول",
        cell: ({ row }) => formatDate(row.original.scheduled_for, locale),
      },
      {
        accessorKey: "sent_at",
        header: "مُرسل",
        cell: ({ row }) =>
          row.original.sent_at ? formatDate(row.original.sent_at, locale) : "—",
      },
      {
        accessorKey: "error",
        header: "خطأ",
        cell: ({ row }) =>
          row.original.error ? (
            <span className="text-xs text-destructive">{row.original.error}</span>
          ) : (
            "—"
          ),
      },
    ],
    [locale]
  );

  if (campaignQuery.isLoading) return <LoadingState />;
  if (campaignQuery.isError) {
    return (
      <ErrorState
        description={toAppError(campaignQuery.error).message}
        onRetry={() => campaignQuery.refetch()}
      />
    );
  }
  const c = campaignQuery.data!;
  const canPause = c.status === "running" || c.status === "scheduled";
  const canResume = c.status === "paused";
  const hasFailed = c.failed_count > 0;
  const progressPct =
    c.total_recipients > 0
      ? Math.round(((c.sent_count + c.failed_count) / c.total_recipients) * 100)
      : 0;

  return (
    <>
      <PageHeader
        title={c.title}
        description={`${targetTypeLabel[c.target_type]} · cap يومي ${c.daily_cap}`}
        action={
          <Link href="/campaigns">
            <Button variant="outline">
              <ArrowRight className="h-4 w-4" />
              العودة للحملات
            </Button>
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="الحالة">
          <Badge variant={statusBadgeVariant[c.status]}>{statusLabel[c.status]}</Badge>
        </Stat>
        <Stat label="إجمالي المستلمين">
          <p className="text-2xl font-bold">{c.total_recipients}</p>
        </Stat>
        <Stat label="تم الإرسال">
          <p className="text-2xl font-bold text-emerald-600">{c.sent_count}</p>
        </Stat>
        <Stat label="فشل">
          <p className="text-2xl font-bold text-destructive">{c.failed_count}</p>
        </Stat>
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">التقدم</p>
          <p className="text-sm text-muted-foreground">{progressPct}%</p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {canPause ? (
            <Button
              variant="secondary"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
            >
              <Pause className="h-4 w-4" />
              إيقاف
            </Button>
          ) : null}
          {canResume ? (
            <Button
              variant="secondary"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              <Play className="h-4 w-4" />
              استئناف
            </Button>
          ) : null}
          {hasFailed ? (
            <Button
              variant="outline"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
            >
              <RefreshCw className="h-4 w-4" />
              إعادة محاولة الفشل
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold">المستلمون</h3>
        <div className="w-48">
          <Select value={recipientFilter} onValueChange={setRecipientFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="pending">{recipientStatusLabel.pending}</SelectItem>
              <SelectItem value="sent">{recipientStatusLabel.sent}</SelectItem>
              <SelectItem value="failed">{recipientStatusLabel.failed}</SelectItem>
              <SelectItem value="skipped">{recipientStatusLabel.skipped}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {recipientsQuery.isLoading ? <LoadingState /> : null}
      {recipientsQuery.isError ? (
        <ErrorState
          description={toAppError(recipientsQuery.error).message}
          onRetry={() => recipientsQuery.refetch()}
        />
      ) : null}
      {recipientsQuery.data ? (
        <DataTable
          columns={columns}
          data={recipientsQuery.data.data}
          emptyTitle="لا يوجد مستلمون مطابقون"
        />
      ) : null}
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
