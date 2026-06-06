"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SearchInput } from "@/components/shared/search-input";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ordersService } from "@/services/orders";
import { useLocale } from "@/lib/i18n";
import type { Order, OrderStatus } from "@/types/database";

const statusLabels: Record<OrderStatus, string> = {
  pending: "قيد الانتظار",
  preparing: "قيد التحضير",
  out_for_delivery: "في الطريق",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

const statusVariants: Record<OrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  preparing: "secondary",
  out_for_delivery: "default",
  delivered: "default",
  cancelled: "destructive",
};

const ALL_STATUSES: OrderStatus[] = ["pending", "preparing", "out_for_delivery", "delivered", "cancelled"];

export function OrdersModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const ordersQuery = useQuery({
    queryKey: ["orders", debouncedSearch, statusFilter],
    queryFn: () =>
      ordersService.getAll({
        search: debouncedSearch,
        filters: statusFilter === "all" ? undefined : { status: statusFilter },
        pageSize: 50,
      }),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["orders"] });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      ordersService.update(id, { status }),
    onSuccess: () => {
      toast.success("تم تحديث حالة الطلب");
      setSelectedOrder(null);
      refresh();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
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
          <Badge variant={statusVariants[row.original.status]}>
            {statusLabels[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: "total_amount",
        header: "الإجمالي",
        cell: ({ row }) => `${row.original.total_amount} ج.م`,
      },
      {
        accessorKey: "contact_phone",
        header: "رقم التواصل",
        cell: ({ row }) => row.original.contact_phone || "—",
      },
      {
        accessorKey: "delivery_address",
        header: "عنوان التسليم",
        cell: ({ row }) => (
          <span className="max-w-[200px] truncate block">{row.original.delivery_address}</span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "التاريخ",
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => setSelectedOrder(row.original)}>
            تغيير الحالة
          </Button>
        ),
      },
    ],
    [locale]
  );

  return (
    <>
      <PageHeader title="الطلبات" description="تصفح الطلبات وتحديث حالاتها." />

      <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-center md:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالحالة أو العنوان أو الموبايل…" />
        <div className="w-full md:w-48">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabels[s]}
                </SelectItem>
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
        <DataTable columns={columns} data={ordersQuery.data.data} emptyTitle="لا يوجد طلبات" />
      ) : null}

      {selectedOrder ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              تحديث حالة الطلب — {selectedOrder.id.slice(0, 8)}…
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">الحالة الحالية</p>
                <Badge variant={statusVariants[selectedOrder.status]}>
                  {statusLabels[selectedOrder.status]}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">الإجمالي</p>
                <p>{selectedOrder.total_amount} ج.م</p>
              </div>
              <div>
                <p className="text-muted-foreground">العنوان</p>
                <p>{selectedOrder.delivery_address}</p>
              </div>
              <div>
                <p className="text-muted-foreground">الموبايل</p>
                <p>{selectedOrder.contact_phone}</p>
              </div>
              {selectedOrder.notes ? (
                <div className="col-span-2">
                  <p className="text-muted-foreground">ملاحظات</p>
                  <p>{selectedOrder.notes}</p>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.filter((s) => s !== selectedOrder.status).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  disabled={updateStatusMutation.isPending}
                  onClick={() => updateStatusMutation.mutate({ id: selectedOrder.id, status: s })}
                >
                  → {statusLabels[s]}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setSelectedOrder(null)}>
                إلغاء
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
