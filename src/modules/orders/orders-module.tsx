"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList } from "lucide-react";
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
import { SearchInput } from "@/components/shared/search-input";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ordersService } from "@/services/orders";
import { useLocale } from "@/lib/i18n";
import type { Order, OrderStatus } from "@/types/database";
import { OrderDetailModal } from "./order-detail-modal";
import {
  ALL_STATUSES,
  OrderStatusBadge,
  SelfDeliveryBadge,
  STATUS_LABELS,
} from "./order-status";

export function OrdersModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
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
          <div className="flex items-center gap-1.5">
            <OrderStatusBadge status={row.original.status as OrderStatus} />
            {row.original.delivery_by_owner ? <SelfDeliveryBadge /> : null}
          </div>
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
          <Button size="sm" variant="outline" onClick={() => setSelectedOrderId(row.original.id)}>
            التفاصيل
          </Button>
        ),
      },
    ],
    [locale]
  );

  return (
    <>
      <PageHeader
        icon={ClipboardList}
        title="الطلبات"
        description="تصفح الطلبات وافتح تفاصيل أي طلب لمتابعة مساره وتحديث حالته."
      />

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
                  {STATUS_LABELS[s]}
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

      <OrderDetailModal
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onUpdated={() => void queryClient.invalidateQueries({ queryKey: ["orders"] })}
      />
    </>
  );
}
