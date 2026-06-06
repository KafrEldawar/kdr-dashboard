"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService, type OrderHistoryRow } from "@/services/admin";
import { useLocale } from "@/lib/i18n";
import type { Order, OrderStatus } from "@/types/database";

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "قيد الانتظار",
  preparing: "قيد التحضير",
  out_for_delivery: "في الطريق",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

const STATUS_VARIANTS: Record<OrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  preparing: "secondary",
  out_for_delivery: "default",
  delivered: "default",
  cancelled: "destructive",
};

const ALL_STATUSES: OrderStatus[] = ["pending", "preparing", "out_for_delivery", "delivered", "cancelled"];

function OrderTimeline({ orderId }: { orderId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["order-history", orderId],
    queryFn: () => adminService.getOrderHistory(orderId),
  });

  if (isLoading) return <p className="text-xs text-muted-foreground p-3">جاري التحميل…</p>;
  if (isError) return <p className="text-xs text-destructive p-3">{toAppError(error).message}</p>;
  if (!data?.length) return <p className="text-xs text-muted-foreground p-3">لا يوجد سجل بعد</p>;

  return (
    <div className="p-3 space-y-2">
      {(data as OrderHistoryRow[]).map((entry, i) => (
        <div key={entry.id} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className={`h-3 w-3 rounded-full border-2 ${
              i === data.length - 1 ? "bg-primary border-primary" : "bg-muted border-muted-foreground"
            }`} />
            {i < data.length - 1 && <div className="w-px h-6 bg-border" />}
          </div>
          <div className="flex-1 pb-1">
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANTS[entry.status as OrderStatus]} className="text-xs">
                {STATUS_LABELS[entry.status as OrderStatus] ?? entry.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDate(entry.created_at, "ar")}
              </span>
            </div>
            {entry.changed_by?.full_name ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                بواسطة: {entry.changed_by.full_name}
              </p>
            ) : null}
            {entry.notes ? <p className="text-xs mt-0.5">{entry.notes}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OrderTrackingModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const ordersQuery = useQuery({
    queryKey: ["orders-tracking", debouncedSearch, statusFilter],
    queryFn: () =>
      adminService.listOrders({
        status: statusFilter !== "all" ? statusFilter : undefined,
        pageSize: 50,
      }),
    retry: false,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) =>
      adminService.updateUser({ userId: orderId }),
    onSuccess: () => {
      toast.success("تم تحديث الحالة");
      void queryClient.invalidateQueries({ queryKey: ["orders-tracking"] });
      void queryClient.invalidateQueries({ queryKey: ["order-history", expandedId] });
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const orders = useMemo(() => {
    const all = ordersQuery.data?.data ?? [];
    if (!debouncedSearch) return all;
    const q = debouncedSearch.toLowerCase();
    return all.filter(
      (o) =>
        o.id.includes(q) ||
        o.status.includes(q) ||
        o.customer?.full_name?.toLowerCase().includes(q) ||
        o.restaurant?.name_ar?.includes(q)
    );
  }, [ordersQuery.data, debouncedSearch]);

  const columns = useMemo<ColumnDef<typeof orders[0]>[]>(
    () => [
      {
        id: "expand",
        header: "",
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpandedId(expandedId === row.original.id ? null : row.original.id)}
          >
            {expandedId === row.original.id ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        ),
      },
      {
        accessorKey: "id",
        header: "رقم الطلب",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.id.slice(0, 8)}…</span>
        ),
      },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANTS[row.original.status as OrderStatus]}>
            {STATUS_LABELS[row.original.status as OrderStatus] ?? row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "restaurant",
        header: "المطعم",
        cell: ({ row }) =>
          locale === "ar"
            ? row.original.restaurant?.name_ar
            : row.original.restaurant?.name_en,
      },
      {
        accessorKey: "customer",
        header: "العميل",
        cell: ({ row }) => row.original.customer?.full_name ?? "—",
      },
      {
        accessorKey: "total_amount",
        header: "الإجمالي",
        cell: ({ row }) => `${row.original.total_amount} ج.م`,
      },
      {
        accessorKey: "created_at",
        header: "التاريخ",
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
    ],
    [locale, expandedId]
  );

  return (
    <>
      <PageHeader
        title="تتبع الطلبات"
        description="عرض مسار كل طلب — يُسجَّل كل تغيير في الحالة تلقائياً."
      />

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
            <Card key={order.id} className="overflow-hidden">
              <CardHeader
                className="py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {expandedId === order.id ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-mono text-xs">{order.id.slice(0, 12)}…</span>
                    <Badge variant={STATUS_VARIANTS[order.status as OrderStatus]}>
                      {STATUS_LABELS[order.status as OrderStatus]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{order.customer?.full_name ?? "—"}</span>
                    <span>{order.total_amount} ج.م</span>
                    <span>{formatDate(order.created_at, locale)}</span>
                  </div>
                </div>
              </CardHeader>
              {expandedId === order.id ? (
                <CardContent className="pt-0 pb-3 border-t">
                  <p className="text-xs font-semibold text-muted-foreground mb-2 mt-3 px-3">
                    مسار الطلب
                  </p>
                  <OrderTimeline orderId={order.id} />
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
