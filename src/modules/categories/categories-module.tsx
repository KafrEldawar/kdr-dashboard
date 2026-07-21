"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit, Trash2, Plus, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Modal } from "@/components/shared/modal";
import { ImageUploader } from "@/components/shared/image-uploader";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService } from "@/services/admin";
import { categoriesService } from "@/services/categories";
import { useTranslations, useLocale } from "@/lib/i18n";
import type { Category } from "@/types/database";

const schema = z.object({
  name_ar: z.string().min(2, "اسم التصنيف بالعربية مطلوب"),
  name_en: z.string().min(2, "Category name in English is required"),
  image_url: z.string().optional(),
  sort_order: z.coerce.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

type CategoryForm = z.infer<typeof schema>;

const defaultValues: CategoryForm = {
  name_ar: "",
  name_en: "",
  image_url: "",
  sort_order: 0,
  is_active: true,
};

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function CategoryFormFields({
  form,
  onSubmit,
  isPending,
  submitLabel,
  onCancel,
}: {
  form: ReturnType<typeof useForm<CategoryForm>>;
  onSubmit: (v: CategoryForm) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  const imageUrl = form.watch("image_url");

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="flex justify-center">
        <ImageUploader
          label="صورة التصنيف"
          type="category"
          value={imageUrl}
          onChange={(url) => form.setValue("image_url", url)}
          variant="square"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="اسم التصنيف (عربي)" error={form.formState.errors.name_ar?.message}>
          <Input {...form.register("name_ar")} placeholder="مثال: المشروبات" />
        </FormField>
        <FormField label="Category Name (English)" error={form.formState.errors.name_en?.message}>
          <Input {...form.register("name_en")} dir="ltr" placeholder="Beverages" />
        </FormField>
        <FormField label="ترتيب العرض">
          <Input {...form.register("sort_order")} type="number" placeholder="0" />
        </FormField>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" {...form.register("is_active")} className="h-4 w-4 rounded border-gray-300" />
          <Label>نشط</Label>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "جاري الحفظ…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function CategoriesModule({
  title,
  description,
}: {
  title?: string;
  description?: string;
} = {}) {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const categoriesQuery = useQuery({
    queryKey: ["categories", debouncedSearch],
    queryFn: () => categoriesService.getAll({ search: debouncedSearch, pageSize: 50 }),
  });

  const createForm = useForm<CategoryForm>({ resolver: zodResolver(schema), defaultValues });
  const editForm = useForm<CategoryForm>({ resolver: zodResolver(schema), defaultValues });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["categories"] });

  const createMutation = useMutation({
    mutationFn: (values: CategoryForm) =>
      adminService.manageCategory({
        action: "create",
        nameAr: values.name_ar,
        nameEn: values.name_en,
        imageUrl: values.image_url || undefined,
        sortOrder: values.sort_order ?? 0,
        isActive: values.is_active ?? true,
      }),
    onSuccess: () => {
      toast.success(t("categories.createdSuccess"));
      createForm.reset(defaultValues);
      setAddOpen(false);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: CategoryForm }) =>
      adminService.manageCategory({
        action: "update",
        id,
        nameAr: values.name_ar,
        nameEn: values.name_en,
        imageUrl: values.image_url || undefined,
        sortOrder: values.sort_order ?? 0,
        isActive: values.is_active ?? true,
      }),
    onSuccess: () => {
      toast.success(t("categories.updatedSuccess"));
      setEditingCategory(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (c: Category) =>
      adminService.manageCategory({ action: "delete", id: c.id }),
    onSuccess: () => {
      toast.success(t("categories.deletedSuccess"));
      setDeletingCategory(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const toggleMutation = useMutation({
    mutationFn: (c: Category) =>
      adminService.manageCategory({ action: "update", id: c.id, isActive: !c.is_active }),
    onSuccess: () => { toast.success(t("categories.updatedSuccess")); refresh(); },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const columns = useMemo<ColumnDef<Category>[]>(
    () => [
      {
        id: "image",
        header: "",
        cell: ({ row }) => {
          const c = row.original;
          return c.image_url ? (
            <img src={c.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">🗂️</div>
          );
        },
      },
      {
        accessorKey: locale === "ar" ? "name_ar" : "name_en",
        header: t("categories.field.name"),
        cell: ({ row }) =>
          locale === "ar" ? row.original.name_ar || "بدون اسم" : row.original.name_en || "No Name",
      },
      {
        accessorKey: "sort_order",
        header: t("categories.field.sortOrder"),
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
        header: t("categories.field.createdAt"),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
      {
        id: "actions",
        header: t("categories.field.actions"),
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingCategory(c);
                  editForm.reset({
                    name_ar: c.name_ar,
                    name_en: c.name_en,
                    image_url: c.image_url || "",
                    sort_order: c.sort_order,
                    is_active: c.is_active,
                  });
                }}
              >
                <Edit className="h-4 w-4" />
                {t("common.edit")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => toggleMutation.mutate(c)}>
                <ToggleRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeletingCategory(c)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [t, locale, editForm, toggleMutation]
  );

  return (
    <>
      <PageHeader
        title={title ?? t("categories.title")}
        description={description ?? t("categories.description")}
        action={
          <Button onClick={() => { createForm.reset(defaultValues); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            {t("categories.createNew")}
          </Button>
        }
      />

      <div className="mb-4 rounded-lg border bg-background p-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t("categories.searchPlaceholder")} />
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
          emptyTitle={t("categories.noCategories")}
        />
      ) : null}

      {/* Add Modal */}
      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("categories.createNew")}
        description="أضف تصنيفاً جديداً لقائمة الطعام"
        size="md"
      >
        <CategoryFormFields
          form={createForm}
          onSubmit={(v) => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          submitLabel={t("categories.createNew")}
          onCancel={() => setAddOpen(false)}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={Boolean(editingCategory)}
        onOpenChange={(open) => !open && setEditingCategory(null)}
        title={t("categories.edit")}
        description={editingCategory ? (locale === "ar" ? editingCategory.name_ar : editingCategory.name_en) : ""}
        size="md"
      >
        <CategoryFormFields
          form={editForm}
          onSubmit={(v) =>
            editingCategory && updateMutation.mutate({ id: editingCategory.id, values: v })
          }
          isPending={updateMutation.isPending}
          submitLabel={t("common.save")}
          onCancel={() => setEditingCategory(null)}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingCategory)}
        title={t("categories.delete")}
        description={t("categories.deleteDesc")}
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => !open && setDeletingCategory(null)}
        onConfirm={() => deletingCategory && deleteMutation.mutate(deletingCategory)}
      />
    </>
  );
}
