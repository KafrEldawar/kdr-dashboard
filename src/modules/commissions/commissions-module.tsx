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

export function CommissionsModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const query = useQuery({
    queryKey: ["restaurants", debouncedSearch],
    queryFn: () => restaurantsService.getAll({ search: debouncedSearch, pageSize: 100 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => {
      const pct = parseFloat(value);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        throw new Error("النسبة لازم تكون بين 0 و 100");
      }
      return restaurantsService.update(id, { commission_percentage: pct });
    },
    onSuccess: () => {
      toast.success("تم تحديث نسبة العمولة");
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
        accessorKey: "commission_percentage",
        header: "نسبة عمولة المنصة (%)",
        cell: ({ row }) => {
          const r = row.original;
          if (editingId === r.id) {
            return (
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="w-24 h-8 text-sm"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
            );
          }
          return `${r.commission_percentage}%`;
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
                  onClick={() => updateMutation.mutate({ id: r.id, value: editValue })}
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
                setEditValue(String(r.commission_percentage));
              }}
            >
              <Edit className="h-4 w-4" />
              تعديل
            </Button>
          );
        },
      },
    ],
    [locale, editingId, editValue, updateMutation]
  );

  return (
    <>
      <PageHeader
        title="عمولات المطاعم"
        description="نسبة عمولة المنصة من كل طلب — تُحفظ نسخة منها داخل كل طلب وقت إنشائه."
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
