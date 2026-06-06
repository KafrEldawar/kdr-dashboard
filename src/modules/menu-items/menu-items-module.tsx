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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { FullScreenDialog } from "@/components/shared/full-screen-dialog";
import { ImageUploader } from "@/components/shared/image-uploader";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { menuItemsService } from "@/services/menu";
import { restaurantsService } from "@/services/restaurants";
import { categoriesService } from "@/services/categories";
import { useTranslations, useLocale } from "@/lib/i18n";
import type { MenuItem } from "@/types/database";

const schema = z.object({
  restaurant_id: z.string().min(1, "اختر مطعم"),
  category_id: z.string().optional(),
  name_ar: z.string().min(2, "اسم الصنف بالعربية مطلوب"),
  name_en: z.string().min(2, "Item name in English is required"),
  description_ar: z.string().optional(),
  description_en: z.string().optional(),
  image_url: z.string().optional(),
  price: z.coerce.number().min(0, "السعر مطلوب"),
  is_available: z.boolean().default(true).optional(),
});

type MenuItemForm = z.infer<typeof schema>;

const defaultValues: MenuItemForm = {
  restaurant_id: "",
  category_id: "",
  name_ar: "",
  name_en: "",
  description_ar: "",
  description_en: "",
  image_url: "",
  price: 0,
  is_available: true,
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

function MenuItemFormFields({
  form,
  restaurants,
  categories,
  onSubmit,
  isPending,
  submitLabel,
  onCancel,
}: {
  form: ReturnType<typeof useForm<MenuItemForm>>;
  restaurants: { id: string; name_ar: string; name_en: string }[];
  categories: { id: string; name_ar: string; name_en: string }[];
  onSubmit: (v: MenuItemForm) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  const imageUrl = form.watch("image_url");

  return (
    <form className="mx-auto max-w-2xl space-y-6 p-6" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="flex justify-center">
        <ImageUploader
          label="صورة الصنف"
          type="menu_item"
          value={imageUrl}
          onChange={(url) => form.setValue("image_url", url)}
          variant="square"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="المطعم" error={form.formState.errors.restaurant_id?.message}>
          <Select
            value={form.watch("restaurant_id")}
            onValueChange={(v) => form.setValue("restaurant_id", v)}
          >
            <SelectTrigger><SelectValue placeholder="اختر مطعم" /></SelectTrigger>
            <SelectContent>
              {restaurants.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name_ar} / {r.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="التصنيف (اختياري)">
          <Select
            value={form.watch("category_id") ?? ""}
            onValueChange={(v) => form.setValue("category_id", v === "none" ? "" : v)}
          >
            <SelectTrigger><SelectValue placeholder="اختر تصنيفاً" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون تصنيف</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name_ar} / {c.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="اسم الصنف (عربي)" error={form.formState.errors.name_ar?.message}>
          <Input {...form.register("name_ar")} placeholder="مثال: برجر كلاسيك" />
        </FormField>
        <FormField label="Item Name (English)" error={form.formState.errors.name_en?.message}>
          <Input {...form.register("name_en")} dir="ltr" placeholder="Classic Burger" />
        </FormField>
        <FormField label="الوصف (عربي)">
          <Textarea {...form.register("description_ar")} rows={2} />
        </FormField>
        <FormField label="Description (English)">
          <Textarea {...form.register("description_en")} dir="ltr" rows={2} />
        </FormField>
        <FormField label="السعر (ج.م)" error={form.formState.errors.price?.message}>
          <Input {...form.register("price")} type="number" step="0.5" />
        </FormField>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" {...form.register("is_available")} className="h-4 w-4 rounded border-gray-300" />
          <Label>متاح</Label>
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "جاري الحفظ…" : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}

export function MenuItemsModule() {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<MenuItem | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const itemsQuery = useQuery({
    queryKey: ["menu-items", debouncedSearch],
    queryFn: () => menuItemsService.getAll({ search: debouncedSearch, pageSize: 50 }),
  });

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-list"],
    queryFn: () => restaurantsService.getAll({ pageSize: 100 }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories-list"],
    queryFn: () => categoriesService.getAll({ pageSize: 100 }),
  });

  const restaurants = restaurantsQuery.data?.data ?? [];
  const categories = categoriesQuery.data?.data ?? [];

  const createForm = useForm<MenuItemForm>({ resolver: zodResolver(schema), defaultValues });
  const editForm = useForm<MenuItemForm>({ resolver: zodResolver(schema), defaultValues });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["menu-items"] });

  const createMutation = useMutation({
    mutationFn: (values: MenuItemForm) =>
      menuItemsService.create({
        restaurant_id: values.restaurant_id,
        category_id: values.category_id || null,
        name_ar: values.name_ar,
        name_en: values.name_en,
        description_ar: values.description_ar || null,
        description_en: values.description_en || null,
        image_url: values.image_url || null,
        price: values.price,
        is_available: values.is_available ?? true,
      }),
    onSuccess: () => {
      toast.success(t("menuItems.createdSuccess"));
      createForm.reset(defaultValues);
      setAddOpen(false);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: MenuItemForm }) =>
      menuItemsService.update(id, {
        category_id: values.category_id || null,
        name_ar: values.name_ar,
        name_en: values.name_en,
        description_ar: values.description_ar || null,
        description_en: values.description_en || null,
        image_url: values.image_url || null,
        price: values.price,
        is_available: values.is_available ?? true,
      }),
    onSuccess: () => {
      toast.success(t("menuItems.updatedSuccess"));
      setEditingItem(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (item: MenuItem) => menuItemsService.delete(item.id),
    onSuccess: () => {
      toast.success(t("menuItems.deletedSuccess"));
      setDeletingItem(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const toggleMutation = useMutation({
    mutationFn: (item: MenuItem) =>
      menuItemsService.update(item.id, { is_available: !item.is_available }),
    onSuccess: () => { toast.success(t("menuItems.updatedSuccess")); refresh(); },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const columns = useMemo<ColumnDef<MenuItem>[]>(
    () => [
      {
        id: "image",
        header: "",
        cell: ({ row }) => {
          const item = row.original;
          return item.image_url ? (
            <img src={item.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">🍴</div>
          );
        },
      },
      {
        accessorKey: locale === "ar" ? "name_ar" : "name_en",
        header: t("menuItems.field.name"),
        cell: ({ row }) =>
          locale === "ar" ? row.original.name_ar || "—" : row.original.name_en || "—",
      },
      {
        accessorKey: "price",
        header: t("menuItems.field.price"),
        cell: ({ row }) => `${row.original.price} ج.م`,
      },
      {
        accessorKey: "is_available",
        header: "التوفر",
        cell: ({ row }) => (
          <Badge variant={row.original.is_available ? "default" : "secondary"}>
            {row.original.is_available ? "متاح" : "غير متاح"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: t("menuItems.field.actions"),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingItem(item);
                  editForm.reset({
                    restaurant_id: item.restaurant_id,
                    category_id: item.category_id || "",
                    name_ar: item.name_ar,
                    name_en: item.name_en,
                    description_ar: item.description_ar || "",
                    description_en: item.description_en || "",
                    image_url: item.image_url || "",
                    price: item.price,
                    is_available: item.is_available,
                  });
                }}
              >
                <Edit className="h-4 w-4" />
                {t("common.edit")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => toggleMutation.mutate(item)}>
                <ToggleRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeletingItem(item)}>
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
        title={t("menuItems.title")}
        description={t("menuItems.description")}
        action={
          <Button onClick={() => { createForm.reset(defaultValues); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            {t("menuItems.createNew")}
          </Button>
        }
      />

      <div className="mb-4 rounded-lg border bg-background p-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t("menuItems.searchPlaceholder")} />
      </div>

      {itemsQuery.isLoading ? <LoadingState /> : null}
      {itemsQuery.isError ? (
        <ErrorState
          description={toAppError(itemsQuery.error).message}
          onRetry={() => itemsQuery.refetch()}
        />
      ) : null}
      {itemsQuery.data ? (
        <DataTable
          columns={columns}
          data={itemsQuery.data.data}
          emptyTitle={t("menuItems.noItems")}
        />
      ) : null}

      {/* Add Dialog */}
      <FullScreenDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("menuItems.createNew")}
        description="أضف صنفاً جديداً إلى قائمة الطعام"
      >
        <MenuItemFormFields
          form={createForm}
          restaurants={restaurants}
          categories={categories}
          onSubmit={(v) => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          submitLabel={t("menuItems.createNew")}
          onCancel={() => setAddOpen(false)}
        />
      </FullScreenDialog>

      {/* Edit Dialog */}
      <FullScreenDialog
        open={Boolean(editingItem)}
        onOpenChange={(open) => !open && setEditingItem(null)}
        title={t("menuItems.edit")}
        description={editingItem ? (locale === "ar" ? editingItem.name_ar : editingItem.name_en) : ""}
      >
        <MenuItemFormFields
          form={editForm}
          restaurants={restaurants}
          categories={categories}
          onSubmit={(v) =>
            editingItem && updateMutation.mutate({ id: editingItem.id, values: v })
          }
          isPending={updateMutation.isPending}
          submitLabel={t("common.save")}
          onCancel={() => setEditingItem(null)}
        />
      </FullScreenDialog>

      <ConfirmDialog
        open={Boolean(deletingItem)}
        title={t("menuItems.delete")}
        description={t("menuItems.deleteDesc")}
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => !open && setDeletingItem(null)}
        onConfirm={() => deletingItem && deleteMutation.mutate(deletingItem)}
      />
    </>
  );
}
