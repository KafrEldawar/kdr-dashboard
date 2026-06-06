"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { promoCodesService } from "@/services/promoCodes";
import { restaurantsService } from "@/services/restaurants";
import { useLocale } from "@/lib/i18n";
import type { DiscountTypeEnum, Voucher, VoucherInsert } from "@/types/database";

const schema = z.object({
  restaurant_id: z.string().min(1, "اختر مطعماً"),
  code: z.string().min(3, "الكود مطلوب — 3 أحرف على الأقل").toUpperCase(),
  discount_type: z.enum(["fixed", "percentage"]),
  discount_value: z.coerce.number().min(1),
  min_order_amount: z.coerce.number().min(0),
  valid_from: z.string().optional(),
  valid_to: z.string().min(1, "تاريخ الانتهاء مطلوب"),
  is_active: z.boolean(),
  usage_limit: z.coerce.number().nullable().optional(),
});

type VoucherForm = z.infer<typeof schema>;

const defaultValues: VoucherForm = {
  restaurant_id: "",
  code: "",
  discount_type: "percentage",
  discount_value: 10,
  min_order_amount: 0,
  valid_from: "",
  valid_to: "",
  is_active: true,
  usage_limit: null,
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

function VoucherFormFields({
  form,
  restaurants,
  onSubmit,
  isPending,
  submitLabel,
  onCancel,
  locale,
}: {
  form: ReturnType<typeof useForm<VoucherForm>>;
  restaurants: { id: string; name_ar: string; name_en: string }[];
  onSubmit: (v: VoucherForm) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
  locale: string;
}) {
  return (
    <form className="mx-auto max-w-2xl p-6" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="المطعم" error={form.formState.errors.restaurant_id?.message}>
          <Select
            value={form.watch("restaurant_id")}
            onValueChange={(v) => form.setValue("restaurant_id", v)}
          >
            <SelectTrigger><SelectValue placeholder="اختر مطعماً" /></SelectTrigger>
            <SelectContent>
              {restaurants.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {locale === "ar" ? r.name_ar : r.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="الكود" error={form.formState.errors.code?.message}>
          <Input {...form.register("code")} dir="ltr" className="uppercase" placeholder="SAVE20" />
        </FormField>

        <FormField label="نوع الخصم" error={form.formState.errors.discount_type?.message}>
          <Select
            value={form.watch("discount_type")}
            onValueChange={(v) => form.setValue("discount_type", v as DiscountTypeEnum)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">نسبة مئوية %</SelectItem>
              <SelectItem value="fixed">مبلغ ثابت ج.م</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="قيمة الخصم" error={form.formState.errors.discount_value?.message}>
          <Input {...form.register("discount_value")} type="number" min={1} />
        </FormField>

        <FormField label="الحد الأدنى للطلب (ج.م)">
          <Input {...form.register("min_order_amount")} type="number" min={0} />
        </FormField>

        <FormField label="حد الاستخدام (فارغ = غير محدود)">
          <Input {...form.register("usage_limit")} type="number" min={1} placeholder="∞" />
        </FormField>

        <FormField label="صالح من">
          <Input {...form.register("valid_from")} type="date" dir="ltr" />
        </FormField>

        <FormField label="صالح حتى" error={form.formState.errors.valid_to?.message}>
          <Input {...form.register("valid_to")} type="date" dir="ltr" />
        </FormField>

        <div className="flex items-center gap-2">
          <input type="checkbox" {...form.register("is_active")} className="h-4 w-4 rounded border-gray-300" />
          <Label>نشط</Label>
        </div>

        <div className="flex gap-3 md:col-span-2 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "جاري الحفظ…" : submitLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            إلغاء
          </Button>
        </div>
      </div>
    </form>
  );
}

export function PromoCodesModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [deletingVoucher, setDeletingVoucher] = useState<Voucher | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const vouchersQuery = useQuery({
    queryKey: ["vouchers", debouncedSearch],
    queryFn: () => promoCodesService.getAll({ search: debouncedSearch, pageSize: 50 }),
  });

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-picker"],
    queryFn: () => restaurantsService.getAll({ pageSize: 100 }),
  });

  const restaurants = restaurantsQuery.data?.data ?? [];

  const createForm = useForm<VoucherForm>({ resolver: zodResolver(schema), defaultValues });
  const editForm = useForm<VoucherForm>({ resolver: zodResolver(schema), defaultValues });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["vouchers"] });

  const createMutation = useMutation({
    mutationFn: (values: VoucherForm) =>
      promoCodesService.create(values as VoucherInsert),
    onSuccess: () => {
      toast.success("تم إنشاء الكود");
      createForm.reset(defaultValues);
      setAddOpen(false);
      refresh();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: VoucherForm }) =>
      promoCodesService.update(id, values),
    onSuccess: () => {
      toast.success("تم تحديث الكود");
      setEditingVoucher(null);
      refresh();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => promoCodesService.delete(id),
    onSuccess: () => {
      toast.success("تم حذف الكود");
      setDeletingVoucher(null);
      refresh();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const columns = useMemo<ColumnDef<Voucher>[]>(
    () => [
      {
        accessorKey: "code",
        header: "الكود",
        cell: ({ row }) => (
          <span className="font-mono font-semibold">{row.original.code}</span>
        ),
      },
      {
        accessorKey: "discount_type",
        header: "نوع الخصم",
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.discount_type === "percentage"
              ? `${row.original.discount_value}%`
              : `${row.original.discount_value} ج.م`}
          </Badge>
        ),
      },
      {
        accessorKey: "min_order_amount",
        header: "الحد الأدنى",
        cell: ({ row }) => `${row.original.min_order_amount} ج.م`,
      },
      {
        accessorKey: "usage_limit",
        header: "الاستخدام",
        cell: ({ row }) =>
          row.original.usage_limit
            ? `${row.original.used_count} / ${row.original.usage_limit}`
            : `${row.original.used_count} / ∞`,
      },
      {
        accessorKey: "is_active",
        header: "الحالة",
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "default" : "secondary"}>
            {row.original.is_active ? "نشط" : "موقوف"}
          </Badge>
        ),
      },
      {
        accessorKey: "valid_to",
        header: "ينتهي",
        cell: ({ row }) => formatDate(row.original.valid_to, locale),
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingVoucher(row.original);
                editForm.reset({
                  restaurant_id: row.original.restaurant_id,
                  code: row.original.code,
                  discount_type: row.original.discount_type,
                  discount_value: row.original.discount_value,
                  min_order_amount: row.original.min_order_amount,
                  valid_from: row.original.valid_from?.slice(0, 10) ?? "",
                  valid_to: row.original.valid_to?.slice(0, 10) ?? "",
                  is_active: row.original.is_active,
                  usage_limit: row.original.usage_limit,
                });
              }}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDeletingVoucher(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [locale, editForm]
  );

  return (
    <>
      <PageHeader
        title="أكواد الخصم"
        description="إدارة أكواد الخصم (vouchers) للمطاعم."
        action={
          <Button onClick={() => { createForm.reset(defaultValues); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            إضافة كود
          </Button>
        }
      />

      <div className="mb-4 rounded-lg border bg-background p-4">
        <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالكود…" />
      </div>

      {vouchersQuery.isLoading ? <LoadingState /> : null}
      {vouchersQuery.isError ? (
        <ErrorState
          description={toAppError(vouchersQuery.error).message}
          onRetry={() => vouchersQuery.refetch()}
        />
      ) : null}
      {vouchersQuery.data ? (
        <DataTable
          columns={columns}
          data={vouchersQuery.data.data}
          emptyTitle="لا يوجد أكواد خصم"
        />
      ) : null}

      {/* Add Dialog */}
      <FullScreenDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="إضافة كود خصم جديد"
        description="أنشئ كوداً جديداً لأحد المطاعم"
      >
        <VoucherFormFields
          form={createForm}
          restaurants={restaurants}
          onSubmit={(v) => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          submitLabel="إضافة الكود"
          onCancel={() => setAddOpen(false)}
          locale={locale}
        />
      </FullScreenDialog>

      {/* Edit Dialog */}
      <FullScreenDialog
        open={Boolean(editingVoucher)}
        onOpenChange={(open) => !open && setEditingVoucher(null)}
        title="تعديل كود الخصم"
        description={editingVoucher?.code ?? ""}
      >
        <VoucherFormFields
          form={editForm}
          restaurants={restaurants}
          onSubmit={(v) =>
            editingVoucher && updateMutation.mutate({ id: editingVoucher.id, values: v })
          }
          isPending={updateMutation.isPending}
          submitLabel="حفظ التعديلات"
          onCancel={() => setEditingVoucher(null)}
          locale={locale}
        />
      </FullScreenDialog>

      {deletingVoucher ? (
        <ConfirmDialog
          open
          title="حذف الكود"
          description={`هل تريد حذف الكود "${deletingVoucher.code}"؟`}
          onConfirm={() => deleteMutation.mutate(deletingVoucher.id)}
          onOpenChange={(open) => { if (!open) setDeletingVoucher(null); }}
        />
      ) : null}
    </>
  );
}
