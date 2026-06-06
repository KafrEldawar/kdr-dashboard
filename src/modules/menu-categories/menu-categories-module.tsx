"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";
import { categoriesService } from "@/services/categories";
import { useTranslations, useLocale } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import type { Category } from "@/types/database";

export function MenuCategoriesModule() {
  const t = useTranslations();
  const locale = useLocale();

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesService.getAll({ pageSize: 100 }),
  });

  const columns = useMemo<ColumnDef<Category>[]>(
    () => [
      {
        accessorKey: "name_ar",
        header: "الاسم",
        cell: ({ row }) =>
          locale === "ar"
            ? row.original.name_ar
            : row.original.name_en,
      },
      {
        accessorKey: "sort_order",
        header: "الترتيب",
        cell: ({ row }) => row.original.sort_order,
      },
      {
        accessorKey: "is_active",
        header: "الحالة",
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "default" : "secondary"}>
            {row.original.is_active ? "نشط" : "غير نشط"}
          </Badge>
        ),
      },
      {
        accessorKey: "created_at",
        header: "تاريخ الإنشاء",
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
    ],
    [locale]
  );

  return (
    <>
      <PageHeader
        title={t("menuCategories.title")}
        description="في المخطط الجديد، تصنيفات المنيو هي نفس التصنيفات العامة (categories). لإضافة أو تعديل تصنيف، استخدم صفحة التصنيفات."
      />

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <strong>ملاحظة:</strong> لا يوجد جدول `menu_categories` منفصل في المخطط الجديد. كل عنصر منيو يرتبط مباشرة بجدول `categories` العام.
        لإدارة التصنيفات، اذهب إلى <a href="/categories" className="underline font-medium">صفحة التصنيفات</a>.
      </div>

      {categoriesQuery.isLoading ? <LoadingState /> : null}
      {categoriesQuery.isError ? (
        <ErrorState
          description={toAppError(categoriesQuery.error).message}
          onRetry={() => categoriesQuery.refetch()}
        />
      ) : null}
      {categoriesQuery.data ? (
        <DataTable
          columns={columns}
          data={categoriesQuery.data.data}
          emptyTitle="لا يوجد تصنيفات"
        />
      ) : null}
    </>
  );
}
