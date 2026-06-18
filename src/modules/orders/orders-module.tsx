"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/modal";
import { cn } from "@/lib/utils";
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
import { OrderRouteMap } from "@/components/maps/order-route-map";

const statusLabels: Record<OrderStatus, string> = {
  pending: "قيد الانتظار",
  preparing: "قيد التحضير",
  ready_for_pickup: "جاهز للاستلام",
  out_for_delivery: "في الطريق",
  delivered: "تم التسليم",
  picked_up_by_customer: "استلمه العميل",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

// Semantic per-status styling (pill background/text + status dot).
const statusStyle: Record<OrderStatus, { pill: string; dot: string }> = {
  pending: {
    pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25",
    dot: "bg-amber-500",
  },
  preparing: {
    pill: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/25",
    dot: "bg-blue-500",
  },
  ready_for_pickup: {
    pill: "bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/25",
    dot: "bg-teal-500",
  },
  out_for_delivery: {
    pill: "bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/25",
    dot: "bg-violet-500",
  },
  delivered: {
    pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
    dot: "bg-emerald-500",
  },
  picked_up_by_customer: {
    pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
    dot: "bg-emerald-500",
  },
  rejected: {
    pill: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25",
    dot: "bg-red-500",
  },
  cancelled: {
    pill: "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-500/15 dark:text-zinc-400 dark:ring-zinc-500/25",
    dot: "bg-zinc-400",
  },
};

function OrderStatusBadge({
  status,
  size = "sm",
}: {
  status: OrderStatus;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        size === "lg" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs",
        statusStyle[status].pill
      )}
    >
      <span className={cn("rounded-full", size === "lg" ? "h-2 w-2" : "h-1.5 w-1.5", statusStyle[status].dot)} />
      {statusLabels[status]}
    </span>
  );
}

const ALL_STATUSES: OrderStatus[] = ["pending", "preparing", "ready_for_pickup", "out_for_delivery", "delivered", "picked_up_by_customer", "rejected", "cancelled"];

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
        cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
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
      <PageHeader icon={ClipboardList} title="الطلبات" description="تصفح الطلبات وتحديث حالاتها." />

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

      <Modal
        open={Boolean(selectedOrder)}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        title="تحديث حالة الطلب"
        description={selectedOrder ? `#${selectedOrder.id.slice(0, 8)}` : ""}
        size="md"
      >
        {selectedOrder ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">الحالة الحالية</span>
                <OrderStatusBadge status={selectedOrder.status} size="lg" />
              </div>
              <div className="text-end">
                <span className="text-xs text-muted-foreground">الإجمالي</span>
                <p className="text-base font-extrabold tabular-nums">{selectedOrder.total_amount} ج.م</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <OrderField label="العنوان" value={selectedOrder.delivery_address || "—"} />
              <OrderField label="الموبايل" value={selectedOrder.contact_phone || "—"} dir="ltr" />
              {/* TODO: surface selectedOrder.alternate_phone here once the
                  design for the dashboard order detail is approved. The
                  field is already plumbed through the DB (orders.alternate_phone)
                  and the Database TS types since migration 037. */}
              <OrderField
                label="رسوم التوصيل"
                value={
                  selectedOrder.delivery_fee != null
                    ? `${Number(selectedOrder.delivery_fee).toFixed(2)} ج.م`
                    : "—"
                }
              />
              <OrderField
                label="المسافة"
                value={
                  (selectedOrder as Order & { delivery_distance_km?: number | null })
                    .delivery_distance_km != null
                    ? `${Number((selectedOrder as Order & { delivery_distance_km: number }).delivery_distance_km).toFixed(2)} كم`
                    : "—"
                }
              />
              {selectedOrder.notes ? (
                <div className="col-span-2">
                  <OrderField label="ملاحظات" value={selectedOrder.notes} />
                </div>
              ) : null}
            </div>

            <OrderRouteMap
              branch={extractPoint(selectedOrder, "branch_lat", "branch_lng")}
              delivery={extractPoint(selectedOrder, "delivery_lat", "delivery_lng")}
              distanceKm={
                (selectedOrder as Order & { delivery_distance_km?: number | null })
                  .delivery_distance_km ?? null
              }
            />

            <div>
              <p className="mb-2 text-sm font-bold">تغيير الحالة إلى</p>
              <div className="grid grid-cols-2 gap-2">
                {ALL_STATUSES.filter((s) => s !== selectedOrder.status).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    className="justify-start"
                    disabled={updateStatusMutation.isPending}
                    onClick={() =>
                      updateStatusMutation.mutate({ id: selectedOrder.id, status: s })
                    }
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", statusStyle[s].dot)} />
                    {statusLabels[s]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function extractPoint(
  order: Order,
  latKey: string,
  lngKey: string,
): { lat: number; lng: number } | null {
  const row = order as unknown as Record<string, unknown>;
  const lat = row[latKey];
  const lng = row[lngKey];
  if (typeof lat === "number" && typeof lng === "number") {
    return { lat, lng };
  }
  return null;
}

function OrderField({
  label,
  value,
  dir,
}: {
  label: string;
  value: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium" dir={dir}>
        {value}
      </p>
    </div>
  );
}
