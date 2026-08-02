"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService } from "@/services/admin";
import { financeService } from "@/services/finance";
import { useLocale } from "@/lib/i18n";
import type { OrderStatus } from "@/types/database";
import { OrderDetailModal } from "@/modules/orders/order-detail-modal";
import {
  ALL_STATUSES,
  OrderStatusBadge,
  STATUS_LABELS,
} from "@/modules/orders/order-status";

/**
 * Live-ops view of the order pipeline. The per-order breakdown —
 * milestones, parties, money, status journal — lives in the shared
 * `OrderDetailModal`, so this page stays a queue: what is in flight,
 * what is stuck, and what needs a human.
 */
export function OrderTrackingModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const ordersQuery = useQuery({
    queryKey: ["orders-tracking", statusFilter],
    queryFn: () =>
      adminService.listOrders({
        status: statusFilter !== "all" ? statusFilter : undefined,
        pageSize: 50,
      }),
    refetchInterval: 30_000,
    retry: false,
  });

  // Delivery orders whose prep window elapsed with no driver claiming them
  const unclaimedQuery = useQuery({
    queryKey: ["orders-unclaimed"],
    queryFn: () => financeService.getUnclaimedOrders(),
    refetchInterval: 30_000,
    retry: false,
  });

  const orders = useMemo(() => {
    const all = ordersQuery.data?.data ?? [];
    if (!debouncedSearch) return all;
    const q = debouncedSearch.toLowerCase();
    return all.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q) ||
        o.customer?.full_name?.toLowerCase().includes(q) ||
        o.restaurant?.name_ar?.includes(q) ||
        o.restaurant?.name_en?.toLowerCase().includes(q)
    );
  }, [ordersQuery.data, debouncedSearch]);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders-tracking"] });
    void queryClient.invalidateQueries({ queryKey: ["orders-unclaimed"] });
  };

  return (
    <>
      <PageHeader
        title="تتبع الطلبات"
        description="حالة كل طلب لحظياً — يُحدَّث تلقائياً كل ٣٠ ثانية."
      />

      {(unclaimedQuery.data?.length ?? 0) > 0 ? (
        <Card className="mb-4 border-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="py-3">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-semibold">
                {unclaimedQuery.data!.length} طلب توصيل بدون مندوب رغم انتهاء وقت التحضير
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-1">
            {unclaimedQuery.data!.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelectedOrderId(o.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-amber-100/60 dark:hover:bg-amber-500/10"
              >
                <span className="font-mono">{o.id.slice(0, 8)}…</span>
                <span>{locale === "ar" ? o.restaurant.name_ar : o.restaurant.name_en}</span>
                <span>{o.customer_name ?? "—"}</span>
                <span>{o.total_amount} ج.م</span>
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  متأخر {o.overdue_minutes} دقيقة
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="ابحث برقم الطلب أو العميل أو المطعم…"
        />
        <div className="w-full md:w-48">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {ordersQuery.isLoading ? <LoadingState /> : null}
      {ordersQuery.isError ? (
        <ErrorState
          description={toAppError(ordersQuery.error).message}
          onRetry={() => ordersQuery.refetch()}
        />
      ) : null}

      {ordersQuery.data ? (
        <div className="space-y-2">
          {orders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                لا يوجد طلبات
              </CardContent>
            </Card>
          ) : null}
          {orders.map((order) => (
            <Card
              key={order.id}
              className="cursor-pointer overflow-hidden transition-colors hover:bg-muted/30"
              onClick={() => setSelectedOrderId(order.id)}
            >
              <CardHeader className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs">{order.id.slice(0, 12)}…</span>
                    <OrderStatusBadge status={order.status as OrderStatus} />
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <Badge variant="outline">
                      {locale === "ar" ? order.restaurant?.name_ar : order.restaurant?.name_en}
                    </Badge>
                    <span>{order.customer?.full_name ?? "—"}</span>
                    <span className="tabular-nums">{order.total_amount} ج.م</span>
                    <span>{formatDate(order.created_at, locale)}</span>
                    <ChevronLeft className="h-4 w-4" />
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      <OrderDetailModal
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onUpdated={refreshAll}
      />
    </>
  );
}
