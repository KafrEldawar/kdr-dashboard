"use client";

import { useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Activity, ClipboardList, Store, Users,
  ShoppingCart, Star, Tag, TrendingUp, Bell, FileText, KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { adminService, type AuditLog, type AuthProviders } from "@/services/admin";
import { useLocale } from "@/lib/i18n";

const TABLE_OPTIONS = [
  "الكل", "profiles", "restaurants", "branches", "categories",
  "menu_items", "offers", "vouchers", "orders",
];

const ACTION_OPTIONS = ["الكل", "create", "update", "delete"];

export function AnalyticsModule() {
  const locale = useLocale();
  const [tableFilter, setTableFilter] = useState("الكل");
  const [actionFilter, setActionFilter] = useState("الكل");

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => adminService.getStats(),
    retry: false,
  });

  const auditQuery = useQuery({
    queryKey: ["audit-logs", tableFilter, actionFilter],
    queryFn: () =>
      adminService.listAuditLogs({
        tableName: tableFilter === "الكل" ? undefined : tableFilter,
        action: actionFilter === "الكل" ? undefined : actionFilter,
        pageSize: 30,
      }),
    retry: false,
  });

  const campaignsQuery = useQuery({
    queryKey: ["campaigns-count"],
    queryFn: () => adminService.listCampaigns({ pageSize: 1 }),
    retry: false,
  });

  const providersQuery = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => adminService.getAuthProviders(),
    retry: false,
  });

  const stats = statsQuery.data;

  const auditColumns = useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        accessorKey: "action",
        header: "الإجراء",
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.action === "delete"
                ? "destructive"
                : row.original.action === "create"
                ? "default"
                : "secondary"
            }
          >
            {row.original.action}
          </Badge>
        ),
      },
      {
        accessorKey: "table_name",
        header: "الجدول",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.table_name}</span>
        ),
      },
      {
        accessorKey: "record_id",
        header: "المعرّف",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.record_id.slice(0, 8)}…</span>
        ),
      },
      {
        accessorKey: "user_name",
        header: "المستخدم",
        cell: ({ row }) => row.original.user_name ?? "النظام",
      },
      {
        accessorKey: "created_at",
        header: "الوقت",
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
    ],
    [locale]
  );

  return (
    <>
      <PageHeader
        title="التحليلات"
        description="إحصائيات النظام الكاملة وسجل الأنشطة."
      />

      {statsQuery.isError ? (
        <ErrorState
          description={`${toAppError(statsQuery.error).message} — تأكد من تسجيل الدخول كأدمن وتفعيل JWT Hook.`}
          onRetry={() => statsQuery.refetch()}
        />
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-8">
        <StatCard label="العملاء" value={stats ? String(stats.users) : "…"} icon={Users} note="مسجلين" />
        <StatCard label="المطاعم" value={stats ? String(stats.restaurants) : "…"} icon={Store} note="نشطة" />
        <StatCard label="الطلبات اليوم" value={stats ? String(stats.orders_today) : "…"} icon={ClipboardList} note={`إجمالي: ${stats?.orders_total ?? "…"}`} />
        <StatCard label="قيد التنفيذ" value={stats ? String(stats.orders_pending) : "…"} icon={Activity} note="pending" />
        <StatCard label="إيرادات اليوم" value={stats ? `${stats.revenue_today} ج.م` : "…"} icon={TrendingUp} note="بدون الملغي" />
        <StatCard label="التصنيفات" value={stats ? String(stats.categories) : "…"} icon={Tag} note="نشطة" />
        <StatCard label="العروض" value={stats ? String(stats.offers) : "…"} icon={ShoppingCart} note="فعّالة" />
        <StatCard label="التقييمات" value={stats ? String(stats.ratings_total) : "…"} icon={Star} note="من طلبات" />
      </section>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bell className="h-4 w-4" /> حملات الإشعارات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {campaignsQuery.data?.meta?.total ?? "…"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">حملة مرسلة</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Store className="h-4 w-4" /> أصحاب المطاعم
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.restaurant_owners ?? "…"}</p>
            <p className="text-xs text-muted-foreground mt-1">حساب مرتبط بمطعم</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" /> أكواد الخصم
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.vouchers ?? "…"}</p>
            <p className="text-xs text-muted-foreground mt-1">كود نشط</p>
          </CardContent>
        </Card>
      </div>

      <AuthProvidersCard query={providersQuery} />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" /> سجل الأنشطة
          </h3>
          <div className="flex gap-2">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABLE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {auditQuery.isLoading ? <LoadingState /> : null}
        {auditQuery.isError ? (
          <ErrorState
            description={toAppError(auditQuery.error).message}
            onRetry={() => auditQuery.refetch()}
          />
        ) : null}
        {auditQuery.data ? (
          <DataTable
            columns={auditColumns}
            data={auditQuery.data.data ?? []}
            emptyTitle="لا يوجد أنشطة مسجلة"
          />
        ) : null}
      </div>
    </>
  );
}

/** Arabic name + accent colour per Supabase auth provider. */
const PROVIDER_META: Record<string, { label: string; bar: string }> = {
  // Not really email signup — it's the synthetic-email scheme the
  // WhatsApp OTP flow uses (migration 051), so it reads as "phone".
  email: { label: "رقم الموبايل (OTP)", bar: "bg-emerald-500" },
  google: { label: "جوجل", bar: "bg-blue-500" },
  apple: { label: "آبل", bar: "bg-zinc-700 dark:bg-zinc-300" },
  phone: { label: "رقم الموبايل", bar: "bg-emerald-500" },
};

function AuthProvidersCard({
  query,
}: {
  query: UseQueryResult<AuthProviders, Error>;
}) {
  const data = query.data;
  const max = Math.max(1, ...(data?.providers.map((p) => p.identities) ?? [1]));

  return (
    <Card className="mb-8">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> طرق تسجيل الدخول
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          حساب واحد ممكن يربط أكتر من طريقة، فمجموع «الارتباطات» بيزيد عن عدد الحسابات.
        </p>
      </CardHeader>
      <CardContent>
        {query.isLoading ? <LoadingState /> : null}
        {query.isError ? (
          <ErrorState
            description={toAppError(query.error).message}
            onRetry={() => query.refetch()}
          />
        ) : null}

        {data ? (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="إجمالي الحسابات" value={data.totals.users} />
              <MiniStat label="نشط آخر ٧ أيام" value={data.totals.active_7d} />
              <MiniStat label="نشط آخر ٣٠ يوم" value={data.totals.active_30d} />
              <MiniStat label="جديد آخر ٣٠ يوم" value={data.totals.new_30d} />
            </div>

            <div className="space-y-3">
              {data.providers.map((p) => {
                const meta = PROVIDER_META[p.provider] ?? {
                  label: p.provider,
                  bar: "bg-primary",
                };
                const share = Math.round((p.identities / data.totals.users) * 100);
                return (
                  <div key={p.provider}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{meta.label}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                        <span>نشط ٧ أيام: {p.active_7d}</span>
                        <span>·</span>
                        <span>جديد ٣٠ يوم: {p.new_30d}</span>
                        <Badge variant="secondary" className="tabular-nums">
                          {p.identities} ({share}%)
                        </Badge>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${meta.bar}`}
                        style={{ width: `${(p.identities / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {data.totals.multi_provider > 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {data.totals.multi_provider} حساب مربوط بأكتر من طريقة دخول.
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
