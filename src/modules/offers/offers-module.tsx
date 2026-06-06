"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit, Plus, Trash2, ToggleRight } from "lucide-react";
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
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { offersService } from "@/services/offers";
import { restaurantsService } from "@/services/restaurants";
import { useLocale } from "@/lib/i18n";
import type { Offer, OfferInsert } from "@/types/database";

const schema = z.object({
  restaurant_id: z.string().min(1, "اختر مطعماً"),
  title_ar: z.string().min(2, "العنوان بالعربية مطلوب"),
  title_en: z.string().optional(),
  description_ar: z.string().optional(),
  description_en: z.string().optional(),
  image_url: z.string().optional(),
  discount_percentage: z.coerce.number().min(1).max(100),
  is_active: z.boolean(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

type OfferForm = z.infer<typeof schema>;

const defaultValues: OfferForm = {
  restaurant_id: "",
  title_ar: "",
  title_en: "",
  description_ar: "",
  description_en: "",
  image_url: "",
  discount_percentage: 10,
  is_active: true,
  start_date: "",
  end_date: "",
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

function OfferFormFields({
  form,
  restaurants,
  onSubmit,
  isPending,
  submitLabel,
  onCancel,
}: {
  form: ReturnType<typeof useForm<OfferForm>>;
  restaurants: { id: string; name_ar: string; name_en: string }[];
  onSubmit: (v: OfferForm) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  const imageUrl = form.watch("image_url");

  return (
    <form className="mx-auto max-w-2xl space-y-6 p-6" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="flex justify-center">
        <ImageUploader
          label="صورة العرض"
          type="offer"
          value={imageUrl}
          onChange={(url) => form.setValue("image_url", url)}
          variant="cover"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="المطعم" error={form.formState.errors.restaurant_id?.message}>
            <Select
              value={form.watch("restaurant_id")}
              onValueChange={(v) => form.setValue("restaurant_id", v)}
            >
              <SelectTrigger><SelectValue placeholder="اختر مطعماً" /></SelectTrigger>
              <SelectContent>
                {restaurants.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name_ar} / {r.name_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField label="عنوان العرض (عربي)" error={form.formState.errors.title_ar?.message}>
          <Input {...form.register("title_ar")} placeholder="مثال: خصم نهاية الأسبوع" />
        </FormField>
        <FormField label="Offer Title (English)">
          <Input {...form.register("title_en")} dir="ltr" placeholder="Weekend Discount" />
        </FormField>
        <FormField label="الوصف (عربي)">
          <Textarea {...form.register("description_ar")} rows={2} />
        </FormField>
        <FormField label="Description (English)">
          <Textarea {...form.register("description_en")} dir="ltr" rows={2} />
        </FormField>
        <FormField label="نسبة الخصم %" error={form.formState.errors.discount_percentage?.message}>
          <Input {...form.register("discount_percentage")} type="number" min="1" max="100" />
        </FormField>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" {...form.register("is_active")} className="h-4 w-4 rounded border-gray-300" defaultChecked />
          <Label>العرض نشط</Label>
        </div>
        <FormField label="تاريخ البداية">
          <Input {...form.register("start_date")} type="date" dir="ltr" />
        </FormField>
        <FormField label="تاريخ الانتهاء">
          <Input {...form.register("end_date")} type="date" dir="ltr" />
        </FormField>
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

export function OffersModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [deletingOffer, setDeletingOffer] = useState<Offer | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const offersQuery = useQuery({
    queryKey: ["offers", debouncedSearch],
    queryFn: () => offersService.getAll({ search: debouncedSearch, pageSize: 50 }),
  });

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-list"],
    queryFn: () => restaurantsService.getAll({ pageSize: 100 }),
  });

  const restaurants = restaurantsQuery.data?.data ?? [];

  const createForm = useForm<OfferForm>({ resolver: zodResolver(schema), defaultValues });
  const editForm = useForm<OfferForm>({ resolver: zodResolver(schema), defaultValues });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["offers"] });

  const createMutation = useMutation({
    mutationFn: (values: OfferForm) =>
      offersService.create({
        restaurant_id: values.restaurant_id,
        title_ar: values.title_ar,
        title_en: values.title_en || null,
        description_ar: values.description_ar || null,
        description_en: values.description_en || null,
        image_url: values.image_url || null,
        discount_percentage: values.discount_percentage,
        is_active: values.is_active,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      } as OfferInsert),
    onSuccess: () => {
      toast.success("تم إضافة العرض");
      createForm.reset(defaultValues);
      setAddOpen(false);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: OfferForm }) =>
      offersService.update(id, {
        title_ar: values.title_ar,
        title_en: values.title_en || null,
        description_ar: values.description_ar || null,
        description_en: values.description_en || null,
        image_url: values.image_url || null,
        discount_percentage: values.discount_percentage,
        is_active: values.is_active,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
      }),
    onSuccess: () => {
      toast.success("تم تحديث العرض");
      setEditingOffer(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (o: Offer) => offersService.delete(o.id),
    onSuccess: () => {
      toast.success("تم حذف العرض");
      setDeletingOffer(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const toggleMutation = useMutation({
    mutationFn: (o: Offer) => offersService.update(o.id, { is_active: !o.is_active }),
    onSuccess: () => { toast.success("تم تحديث العرض"); refresh(); },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const getRestaurantName = (id: string) => {
    const r = restaurants.find((r) => r.id === id);
    return r ? (locale === "ar" ? r.name_ar : r.name_en) : "—";
  };

  const columns = useMemo<ColumnDef<Offer>[]>(
    () => [
      {
        id: "image",
        header: "",
        cell: ({ row }) => {
          const o = row.original;
          return o.image_url ? (
            <img src={o.image_url} alt="" className="h-10 w-14 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-muted text-lg">🏷️</div>
          );
        },
      },
      {
        accessorKey: "title_ar",
        header: "العنوان",
        cell: ({ row }) =>
          locale === "ar" ? row.original.title_ar : (row.original.title_en ?? row.original.title_ar),
      },
      {
        accessorKey: "restaurant_id",
        header: "المطعم",
        cell: ({ row }) => getRestaurantName(row.original.restaurant_id),
      },
      {
        accessorKey: "discount_percentage",
        header: "نسبة الخصم",
        cell: ({ row }) => `${row.original.discount_percentage}%`,
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
        accessorKey: "end_date",
        header: "ينتهي",
        cell: ({ row }) => row.original.end_date ? formatDate(row.original.end_date, locale) : "—",
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingOffer(o);
                  editForm.reset({
                    restaurant_id: o.restaurant_id,
                    title_ar: o.title_ar,
                    title_en: o.title_en || "",
                    description_ar: o.description_ar || "",
                    description_en: o.description_en || "",
                    image_url: o.image_url || "",
                    discount_percentage: o.discount_percentage,
                    is_active: o.is_active,
                    start_date: o.start_date?.split("T")[0] ?? "",
                    end_date: o.end_date?.split("T")[0] ?? "",
                  });
                }}
              >
                <Edit className="h-4 w-4" />
                تعديل
              </Button>
              <Button size="sm" variant="secondary" onClick={() => toggleMutation.mutate(o)}>
                <ToggleRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeletingOffer(o)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [locale, editForm, toggleMutation, restaurants]
  );

  return (
    <>
      <PageHeader
        title="العروض"
        description="إدارة العروض والتخفيضات على المطاعم"
        action={
          <Button onClick={() => { createForm.reset(defaultValues); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            إضافة عرض
          </Button>
        }
      />

      <div className="mb-4 rounded-lg border bg-background p-4">
        <SearchInput value={search} onChange={setSearch} placeholder="ابحث في العروض…" />
      </div>

      {offersQuery.isLoading ? <LoadingState /> : null}
      {offersQuery.isError ? (
        <ErrorState
          description={toAppError(offersQuery.error).message}
          onRetry={() => offersQuery.refetch()}
        />
      ) : null}
      {offersQuery.data ? (
        <DataTable columns={columns} data={offersQuery.data.data} emptyTitle="لا يوجد عروض" />
      ) : null}

      {/* Add Dialog */}
      <FullScreenDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="إضافة عرض جديد"
        description="أدخل تفاصيل العرض والمطعم المرتبط به"
      >
        <OfferFormFields
          form={createForm}
          restaurants={restaurants}
          onSubmit={(v) => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          submitLabel="إضافة العرض"
          onCancel={() => setAddOpen(false)}
        />
      </FullScreenDialog>

      {/* Edit Dialog */}
      <FullScreenDialog
        open={Boolean(editingOffer)}
        onOpenChange={(open) => !open && setEditingOffer(null)}
        title="تعديل العرض"
        description={editingOffer ? (locale === "ar" ? editingOffer.title_ar : (editingOffer.title_en ?? editingOffer.title_ar)) : ""}
      >
        <OfferFormFields
          form={editForm}
          restaurants={restaurants}
          onSubmit={(v) => editingOffer && updateMutation.mutate({ id: editingOffer.id, values: v })}
          isPending={updateMutation.isPending}
          submitLabel="حفظ التعديلات"
          onCancel={() => setEditingOffer(null)}
        />
      </FullScreenDialog>

      <ConfirmDialog
        open={Boolean(deletingOffer)}
        title="حذف العرض"
        description="هل أنت متأكد من حذف هذا العرض؟ لا يمكن التراجع."
        confirmLabel="حذف"
        onOpenChange={(open) => !open && setDeletingOffer(null)}
        onConfirm={() => deletingOffer && deleteMutation.mutate(deletingOffer)}
      />
    </>
  );
}
