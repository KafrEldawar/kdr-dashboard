"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  MessageCircle,
  RefreshCw,
  XCircle,
  Server,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toAppError } from "@/lib/errors";

type ServiceStatus = "ok" | "degraded" | "down" | "unconfigured";

type ServiceReport = {
  status:    ServiceStatus;
  latencyMs: number | null;
  detail?:   string;
  error?:    string;
};

type SystemEvent = {
  id:       string;
  ts:       string;
  source:   string;
  severity: "info" | "warn" | "error";
  event:    string;
  message?: string | null;
  context?: Record<string, unknown> | null;
};

type StatusResponse = {
  ts:        string;
  services:  {
    whatsapp:      ServiceReport;
    supabase:      ServiceReport;
    edgeFunctions: ServiceReport;
  };
  summary:   {
    window_minutes: number;
    counts:         Record<string, number>;
    by_source:      Array<{ source: string; errors: number; warns: number; infos: number; last_ts: string }>;
  } | null;
  events:    SystemEvent[];
  feedError?: string;
};

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status", { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as StatusResponse;
}

const STATUS_META: Record<ServiceStatus, { label: string; badge: "success" | "warning" | "destructive" | "outline"; ring: string }> = {
  ok:           { label: "يعمل",       badge: "success",     ring: "ring-emerald-500/30" },
  degraded:     { label: "متأخر",      badge: "warning",     ring: "ring-amber-500/30" },
  down:         { label: "متوقف",      badge: "destructive", ring: "ring-rose-500/30" },
  unconfigured: { label: "غير معدّ",   badge: "outline",     ring: "ring-border" },
};

const SEVERITY_META: Record<SystemEvent["severity"], { color: string; icon: typeof AlertCircle; label: string }> = {
  info:  { color: "text-sky-500",     icon: Activity,       label: "معلومة" },
  warn:  { color: "text-amber-500",   icon: AlertTriangle,  label: "تحذير" },
  error: { color: "text-rose-500",    icon: XCircle,        label: "خطأ" },
};

function StatusCard({
  title,
  icon: Icon,
  report,
}: {
  title: string;
  icon: typeof MessageCircle;
  report: ServiceReport;
}) {
  const meta = STATUS_META[report.status];
  return (
    <div className={cn(
      "rounded-2xl border border-border bg-card p-5 ring-1 transition-colors",
      meta.ring,
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <Badge variant={meta.badge} className="mt-1">{meta.label}</Badge>
          </div>
        </div>
        {report.latencyMs !== null ? (
          <p className="text-xs text-muted-foreground tabular-nums">{report.latencyMs} ms</p>
        ) : null}
      </div>
      {report.detail ? (
        <p className="mt-3 text-sm text-muted-foreground">{report.detail}</p>
      ) : null}
      {report.error ? (
        <p className="mt-3 text-xs text-rose-500 break-words">{report.error}</p>
      ) : null}
    </div>
  );
}

function OverallBadge({ services }: { services: StatusResponse["services"] }) {
  const list = Object.values(services);
  const hasDown = list.some((s) => s.status === "down");
  const hasDegraded = list.some((s) => s.status === "degraded");
  const anyUnconfigured = list.some((s) => s.status === "unconfigured");

  if (hasDown)       return <Badge variant="destructive" className="gap-1.5"><XCircle className="h-3.5 w-3.5" />فيه خدمة متوقفة</Badge>;
  if (hasDegraded)   return <Badge variant="warning"     className="gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />خدمة متأخرة</Badge>;
  if (anyUnconfigured) return <Badge variant="outline"   className="gap-1.5"><AlertCircle className="h-3.5 w-3.5" />خدمة غير معدّة</Badge>;
  return <Badge variant="success" className="gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />كل الخدمات شغالة</Badge>;
}

function EventRow({ event }: { event: SystemEvent }) {
  const meta = SEVERITY_META[event.severity];
  const Icon = meta.icon;
  const ctxKeys = event.context ? Object.keys(event.context) : [];
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card/60 p-3">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.color)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{event.source}</span>
          <span className="text-muted-foreground/60">•</span>
          <span className="font-semibold text-sm">{event.event}</span>
          <span className="ms-auto text-xs text-muted-foreground tabular-nums">
            {formatDate(event.ts)}
          </span>
        </div>
        {event.message ? (
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">{event.message}</p>
        ) : null}
        {ctxKeys.length > 0 ? (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              تفاصيل ({ctxKeys.length} حقول)
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted/40 p-2 text-[11px] leading-relaxed" dir="ltr">
              {JSON.stringify(event.context, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function StatusModule() {
  const query = useQuery({
    queryKey: ["kdr-status"],
    queryFn:  fetchStatus,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const data = query.data;

  const errorCount = useMemo(() => data?.summary?.counts?.error ?? 0, [data]);
  const warnCount  = useMemo(() => data?.summary?.counts?.warn  ?? 0, [data]);

  return (
    <>
      <PageHeader
        icon={Server}
        title="حالة الأنظمة"
        description="متابعة حية لخدمات KDR — الواتساب سيندر، Supabase، والـ Edge Functions — بالإضافة لسجل الأحداث والأخطاء المهمة آخر 24 ساعة. الصفحة بتحدّث نفسها كل 15 ثانية."
        action={
          <div className="flex items-center gap-3">
            {data ? <OverallBadge services={data.services} /> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} />
              تحديث
            </Button>
          </div>
        }
      />

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          description={toAppError(query.error).message}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {data ? (
        <div className="space-y-6">
          {/* Service cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <StatusCard title="واتساب سيندر"    icon={MessageCircle} report={data.services.whatsapp} />
            <StatusCard title="Supabase"        icon={Database}      report={data.services.supabase} />
            <StatusCard title="Edge Functions" icon={Cloud}         report={data.services.edgeFunctions} />
          </div>

          {/* Summary strip */}
          {data.summary ? (
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  آخر {data.summary.window_minutes} دقايق:
                </span>
                <span className="flex items-center gap-1.5">
                  <XCircle className={cn("h-4 w-4", errorCount > 0 ? "text-rose-500" : "text-muted-foreground")} />
                  <strong className={errorCount > 0 ? "text-rose-500" : ""}>{errorCount}</strong>
                  <span className="text-muted-foreground">أخطاء</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className={cn("h-4 w-4", warnCount > 0 ? "text-amber-500" : "text-muted-foreground")} />
                  <strong className={warnCount > 0 ? "text-amber-500" : ""}>{warnCount}</strong>
                  <span className="text-muted-foreground">تحذيرات</span>
                </span>

                {data.summary.by_source.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 ms-auto">
                    {data.summary.by_source.map((s) => (
                      <span
                        key={s.source}
                        className="rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-xs"
                      >
                        <span className="font-mono">{s.source}</span>
                        {s.errors > 0 ? <span className="ms-1 text-rose-500">×{s.errors}</span> : null}
                        {s.warns  > 0 ? <span className="ms-1 text-amber-500">⚠{s.warns}</span>  : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Event timeline */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">سجل الأحداث (آخر 24 ساعة)</h3>
              {data.feedError ? (
                <span className="text-xs text-rose-500">{data.feedError}</span>
              ) : (
                <span className="text-xs text-muted-foreground">{data.events.length} حدث</span>
              )}
            </div>
            {data.events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
                مفيش أحداث مسجلة. كل حاجة تمام.
              </div>
            ) : (
              <div className="space-y-2">
                {data.events.map((e) => <EventRow key={e.id} event={e} />)}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            آخر تحديث: <span className="tabular-nums">{formatDate(data.ts)}</span>
          </p>
        </div>
      ) : null}
    </>
  );
}
