"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { restaurantsService } from "@/services/restaurants";
import { useLocale } from "@/lib/i18n";
import type { Restaurant } from "@/types/database";

type EditState = { delivery_fee: string; min_order_amount: string };

export function DeliveryFeesModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ delivery_fee: "", min_order_amount: "" });
  const debouncedSearch = useDebouncedValue(search);

  const query = useQuery({
    queryKey: ["restaurants", debouncedSearch],
    queryFn: () => restaurantsService.getAll({ search: debouncedSearch, pageSize: 100 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, vals }: { id: string; vals: EditState }) =>
      restaurantsService.update(id, {
        delivery_fee: parseFloat(vals.delivery_fee) || 0,
        min_order_amount: parseFloat(vals.min_order_amount) || 0,
      }),
    onSuccess: () => {
      toast.success("تم تحديث رسوم التوصيل");
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["restaurants"] });
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const columns = useMemo<ColumnDef<Restaurant>[]>(
    () => [
      {
        accessorKey: "name_ar",
        header: "المطعم",
        cell: ({ row }) =>
          locale === "ar" ? row.original.name_ar : row.original.name_en,
      },
      {
        accessorKey: "delivery_fee",
        header: "رسوم التوصيل (ج.م)",
        cell: ({ row }) => {
          const r = row.original;
          if (editingId === r.id) {
            return (
              <Input
                type="number"
                min={0}
                step={0.5}
                className="w-24 h-8 text-sm"
                value={editState.delivery_fee}
                onChange={(e) => setEditState((s) => ({ ...s, delivery_fee: e.target.value }))}
              />
            );
          }
          return `${r.delivery_fee} ج.م`;
        },
      },
      {
        accessorKey: "min_order_amount",
        header: "الحد الأدنى للطلب (ج.م)",
        cell: ({ row }) => {
          const r = row.original;
          if (editingId === r.id) {
            return (
              <Input
                type="number"
                min={0}
                step={0.5}
                className="w-24 h-8 text-sm"
                value={editState.min_order_amount}
                onChange={(e) => setEditState((s) => ({ ...s, min_order_amount: e.target.value }))}
              />
            );
          }
          return `${r.min_order_amount} ج.م`;
        },
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => {
          const r = row.original;
          if (editingId === r.id) {
            return (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: r.id, vals: editState })}
                >
                  <Save className="h-4 w-4" />
                  حفظ
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          }
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingId(r.id);
                setEditState({
                  delivery_fee: String(r.delivery_fee),
                  min_order_amount: String(r.min_order_amount),
                });
              }}
            >
              <Edit className="h-4 w-4" />
              تعديل
            </Button>
          );
        },
      },
    ],
    [locale, editingId, editState, updateMutation]
  );

  return (
    <>
      <PageHeader
        title="رسوم التوصيل"
        description="تعديل رسوم التوصيل والحد الأدنى للطلب لكل مطعم."
      />
      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالمطعم…" />
      </div>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState description={toAppError(query.error).message} onRetry={() => query.refetch()} />
      ) : null}
      {query.data ? (
        <DataTable columns={columns} data={query.data.data} emptyTitle="لا يوجد مطاعم" />
      ) : null}
    </>
  );
}
