"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, Bike, ClipboardList, Store, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { StatCard } from "@/components/shared/stat-card";
import { toAppError } from "@/lib/errors";
import { restaurantsService } from "@/services/restaurants";
import {
  financeService,
  type FinancialPeriod,
  type FinancialRestaurantRow,
} from "@/services/finance";
import { useLocale } from "@/lib/i18n";

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const egp = (n: number) => `${Number(n ?? 0).toLocaleString("ar-EG")} ج.م`;

export function FinanceModule() {
  const locale = useLocale();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [restaurantId, setRestaurantId] = useState("all");
  const [groupBy, setGroupBy] = useState<"day" | "month">("day");

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-for-finance"],
    queryFn: () => restaurantsService.getAll({ pageSize: 100 }),
  });

  const reportQuery = useQuery({
    queryKey: ["finance-report", from, to, restaurantId, groupBy],
    queryFn: () =>
      financeService.getReport({
        from,
        to,
        restaurantId: restaurantId === "all" ? undefined : restaurantId,
        groupBy,
      }),
  });

  const periodColumns = useMemo<ColumnDef<FinancialPeriod>[]>(
    () => [
      { accessorKey: "period", header: groupBy === "day" ? "اليوم" : "الشهر" },
      { accessorKey: "orders_count", header: "عدد الطلبات" },
      {
        accessorKey: "gross_sales",
        header: "إجمالي المبيعات",
        cell: ({ row }) => egp(row.original.gross_sales),
      },
      {
        accessorKey: "platform_revenue",
        header: "إيراد المنصة",
        cell: ({ row }) => egp(row.original.platform_revenue),
      },
      {
        accessorKey: "restaurant_revenue",
        header: "إيراد المطاعم",
        cell: ({ row }) => egp(row.original.restaurant_revenue),
      },
    ],
    [groupBy]
  );

  const restaurantColumns = useMemo<ColumnDef<FinancialRestaurantRow>[]>(
    () => [
      {
        accessorKey: "name_ar",
        header: "المطعم",
        cell: ({ row }) =>
          locale === "ar" ? row.original.name_ar : row.original.name_en,
      },
      {
        accessorKey: "current_commission_percentage",
        header: "العمولة الحالية",
        cell: ({ row }) => `${row.original.current_commission_percentage}%`,
      },
      { accessorKey: "orders_count", header: "عدد الطلبات" },
      {
        accessorKey: "gross_sales",
        header: "إجمالي المبيعات",
        cell: ({ row }) => egp(row.original.gross_sales),
      },
      {
        accessorKey: "platform_revenue",
        header: "إيراد المنصة",
        cell: ({ row }) => egp(row.original.platform_revenue),
      },
      {
        accessorKey: "restaurant_revenue",
        header: "إيراد المطعم",
        cell: ({ row }) => egp(row.original.restaurant_revenue),
      },
      {
        accessorKey: "self_delivery_earnings",
        header: "إيراد التوصيل الذاتي",
        cell: ({ row }) => (
          <span title={`${row.original.self_delivery_orders_count} طلب`}>
            {egp(row.original.self_delivery_earnings)}
          </span>
        ),
      },
    ],
    [locale]
  );

  const totals = reportQuery.data?.totals;

  return (
    <>
      <PageHeader
        title="التقارير المالية"
        description="المبيعات وإيرادات العمولة — الطلبات المكتملة فقط (تم توصيلها أو استلمها العميل)."
      />

      {/* Filters */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="space-y-1">
          <Label>من</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>إلى</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>المطعم</Label>
          <Select value={restaurantId} onValueChange={setRestaurantId}>
            <SelectTrigger>
              <SelectValue placeholder="كل المطاعم" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المطاعم</SelectItem>
              {(restaurantsQuery.data?.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {locale === "ar" ? r.name_ar : r.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>التجميع</Label>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "day" | "month")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">يومي</SelectItem>
              <SelectItem value="month">شهري</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {reportQuery.isLoading ? <LoadingState /> : null}
      {reportQuery.isError ? (
        <ErrorState
          description={toAppError(reportQuery.error).message}
          onRetry={() => reportQuery.refetch()}
        />
      ) : null}

      {totals ? (
        <>
          {/* Totals */}
          <div className="mb-6 grid gap-4 md:grid-cols-4">
            <StatCard
              label="عدد الطلبات المكتملة"
              value={String(totals.orders_count)}
              icon={ClipboardList}
            />
            <StatCard
              label="إجمالي المبيعات"
              value={egp(totals.gross_sales)}
              icon={Banknote}
            />
            <StatCard
              label="إيراد المنصة (العمولات)"
              value={egp(totals.platform_revenue)}
              icon={Wallet}
            />
            <StatCard
              label="إيراد المطاعم"
              value={egp(totals.restaurant_revenue)}
              icon={Store}
            />
          </div>
          {totals.self_delivery_orders_count > 0 ? (
            <div className="mb-6">
              <StatCard
                label={`إيراد التوصيل الذاتي (${totals.self_delivery_orders_count} طلب)`}
                value={egp(totals.self_delivery_earnings)}
                icon={Bike}
              />
            </div>
          ) : null}

          {/* Per-period breakdown */}
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            التفصيل الزمني
          </h3>
          <div className="mb-6">
            <DataTable
              columns={periodColumns}
              data={reportQuery.data?.periods ?? []}
              emptyTitle="لا توجد بيانات في هذه الفترة"
            />
          </div>

          {/* Per-restaurant breakdown */}
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            تقرير العمولات حسب المطعم
          </h3>
          <DataTable
            columns={restaurantColumns}
            data={reportQuery.data?.restaurants ?? []}
            emptyTitle="لا توجد بيانات في هذه الفترة"
          />
        </>
      ) : null}
    </>
  );
}
