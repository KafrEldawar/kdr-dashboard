"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit, Trash2, Plus, Phone } from "lucide-react";
import { toast } from "sonner";
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
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { branchesService, branchPhonesService } from "@/services/branches";
import { restaurantsService } from "@/services/restaurants";
import { useTranslations, useLocale } from "@/lib/i18n";
import type { Branch, Restaurant } from "@/types/database";

const schema = z.object({
  restaurant_id: z.string().min(1, "اختر مطعم"),
  name_ar: z.string().optional(),
  name_en: z.string().optional(),
  address_ar: z.string().min(3, "العنوان بالعربية مطلوب"),
  address_en: z.string().min(3, "Address in English is required"),
  location_url: z.string().url("رابط الموقع غير صحيح").optional().or(z.literal("")),
  phones: z.array(z.string()),
});

type BranchForm = z.infer<typeof schema>;

const defaultValues: BranchForm = {
  restaurant_id: "",
  name_ar: "",
  name_en: "",
  address_ar: "",
  address_en: "",
  location_url: "",
  phones: [],
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

function PhonesField({ form }: { form: ReturnType<typeof useForm<BranchForm>> }) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "phones" as never,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-muted-foreground" />
        <Label>أرقام الهاتف</Label>
      </div>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد أرقام</p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <Input
                {...form.register(`phones.${index}`)}
                type="tel"
                dir="ltr"
                placeholder="01xxxxxxxxx"
                className="flex-1"
              />
              <Button
                type="button"
                size="icon"
                variant="destructive"
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append("")}
      >
        <Plus className="h-4 w-4" /> إضافة رقم
      </Button>
    </div>
  );
}

function BranchFormFields({
  form,
  restaurants,
  onSubmit,
  isPending,
  submitLabel,
  onCancel,
  lockRestaurant,
}: {
  form: ReturnType<typeof useForm<BranchForm>>;
  restaurants: Restaurant[];
  onSubmit: (v: BranchForm) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
  lockRestaurant?: boolean;
}) {
  return (
    <form className="mx-auto max-w-lg space-y-6 p-6" onSubmit={form.handleSubmit(onSubmit)}>
      <FormField label="المطعم" error={form.formState.errors.restaurant_id?.message}>
        <Select
          value={form.watch("restaurant_id")}
          onValueChange={(v) => form.setValue("restaurant_id", v)}
          disabled={lockRestaurant}
        >
          <SelectTrigger>
            <SelectValue placeholder="اختر مطعم" />
          </SelectTrigger>
          <SelectContent>
            {restaurants.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name_ar} / {r.name_en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="اسم الفرع (عربي)">
          <Input {...form.register("name_ar")} placeholder="الفرع الرئيسي" />
        </FormField>
        <FormField label="Branch Name (English)">
          <Input {...form.register("name_en")} dir="ltr" placeholder="Main Branch" />
        </FormField>
        <FormField label="العنوان (عربي)" error={form.formState.errors.address_ar?.message}>
          <Input {...form.register("address_ar")} placeholder="شارع كذا، المدينة" />
        </FormField>
        <FormField label="Address (English)" error={form.formState.errors.address_en?.message}>
          <Input {...form.register("address_en")} dir="ltr" placeholder="Street, City" />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="رابط الموقع (اختياري)" error={form.formState.errors.location_url?.message}>
            <Input {...form.register("location_url")} dir="ltr" placeholder="https://maps.google.com/..." />
          </FormField>
        </div>
      </div>

      <PhonesField form={form} />

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

export function BranchesModule() {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);
  const [editBranchId, setEditBranchId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const branchesQuery = useQuery({
    queryKey: ["branches", debouncedSearch],
    queryFn: () => branchesService.getAll({ search: debouncedSearch, pageSize: 50 }),
  });

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-list"],
    queryFn: () => restaurantsService.getAll({ pageSize: 100 }),
  });

  const phonesQuery = useQuery({
    queryKey: ["branch-phones", editBranchId],
    queryFn: () =>
      editBranchId
        ? branchPhonesService.getByBranchId(editBranchId)
        : Promise.resolve([]),
    enabled: !!editBranchId,
  });

  const restaurants = restaurantsQuery.data?.data ?? [];

  const createForm = useForm<BranchForm>({ resolver: zodResolver(schema), defaultValues });
  const editForm = useForm<BranchForm>({ resolver: zodResolver(schema), defaultValues });

  useEffect(() => {
    if (phonesQuery.data && editingBranch) {
      editForm.setValue("phones", phonesQuery.data.map((p) => p.phone));
    }
  }, [phonesQuery.data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["branches"] });

  const createMutation = useMutation({
    mutationFn: async (values: BranchForm) => {
      const result = await branchesService.create({
        restaurant_id: values.restaurant_id,
        name_ar: values.name_ar || null,
        name_en: values.name_en || null,
        address_ar: values.address_ar,
        address_en: values.address_en,
        location_url: values.location_url || null,
      });
      const filteredPhones = values.phones.filter(Boolean);
      if (filteredPhones.length > 0) {
        await branchPhonesService.syncPhones(result.data.id, filteredPhones);
      }
    },
    onSuccess: () => {
      toast.success(t("branches.createdSuccess"));
      createForm.reset(defaultValues);
      setAddOpen(false);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: BranchForm }) => {
      await branchesService.update(id, {
        name_ar: values.name_ar || null,
        name_en: values.name_en || null,
        address_ar: values.address_ar,
        address_en: values.address_en,
        location_url: values.location_url || null,
      });
      await branchPhonesService.syncPhones(id, values.phones.filter(Boolean));
    },
    onSuccess: () => {
      toast.success(t("branches.updatedSuccess"));
      setEditingBranch(null);
      setEditBranchId(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (b: Branch) => branchesService.delete(b.id),
    onSuccess: () => {
      toast.success(t("branches.deletedSuccess"));
      setDeletingBranch(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const getRestaurantName = (id: string) => {
    const r = restaurants.find((r) => r.id === id);
    return r ? (locale === "ar" ? r.name_ar : r.name_en) : "—";
  };

  const columns = useMemo<ColumnDef<Branch>[]>(
    () => [
      {
        accessorKey: "name_ar",
        header: t("branches.field.name"),
        cell: ({ row }) => {
          const b = row.original;
          return locale === "ar" ? b.name_ar || b.address_ar : b.name_en || b.address_en;
        },
      },
      {
        accessorKey: "restaurant_id",
        header: "المطعم",
        cell: ({ row }) => getRestaurantName(row.original.restaurant_id),
      },
      {
        accessorKey: "address_ar",
        header: t("branches.field.address"),
        cell: ({ row }) =>
          locale === "ar" ? row.original.address_ar : row.original.address_en,
      },
      {
        accessorKey: "location_url",
        header: "الموقع",
        cell: ({ row }) =>
          row.original.location_url ? (
            <a href={row.original.location_url} target="_blank" rel="noreferrer" className="text-primary underline">
              خريطة
            </a>
          ) : "—",
      },
      {
        id: "actions",
        header: t("branches.field.actions"),
        cell: ({ row }) => {
          const b = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingBranch(b);
                  setEditBranchId(b.id);
                  editForm.reset({
                    restaurant_id: b.restaurant_id,
                    name_ar: b.name_ar || "",
                    name_en: b.name_en || "",
                    address_ar: b.address_ar,
                    address_en: b.address_en,
                    location_url: b.location_url || "",
                    phones: [],
                  });
                }}
              >
                <Edit className="h-4 w-4" />
                {t("common.edit")}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeletingBranch(b)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [t, locale, editForm, restaurants]
  );

  return (
    <>
      <PageHeader
        title={t("branches.title")}
        description={t("branches.description")}
        action={
          <Button onClick={() => { createForm.reset(defaultValues); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            {t("branches.createNew")}
          </Button>
        }
      />

      <div className="mb-4 rounded-lg border bg-background p-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t("branches.searchPlaceholder")} />
      </div>

      {branchesQuery.isLoading ? <LoadingState /> : null}
      {branchesQuery.isError ? (
        <ErrorState
          description={toAppError(branchesQuery.error).message}
          onRetry={() => branchesQuery.refetch()}
        />
      ) : null}
      {branchesQuery.data ? (
        <DataTable
          columns={columns}
          data={branchesQuery.data.data}
          emptyTitle={t("branches.noBranches")}
        />
      ) : null}

      {/* Add Dialog */}
      <FullScreenDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("branches.createNew")}
        description="أضف فرعاً جديداً لأحد المطاعم"
      >
        <BranchFormFields
          form={createForm}
          restaurants={restaurants}
          onSubmit={(v) => createMutation.mutate(v)}
          isPending={createMutation.isPending}
          submitLabel={t("branches.createNew")}
          onCancel={() => setAddOpen(false)}
        />
      </FullScreenDialog>

      {/* Edit Dialog */}
      <FullScreenDialog
        open={Boolean(editingBranch)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingBranch(null);
            setEditBranchId(null);
          }
        }}
        title={t("branches.edit")}
        description={
          editingBranch
            ? (locale === "ar" ? (editingBranch.name_ar ?? editingBranch.address_ar) : (editingBranch.name_en ?? editingBranch.address_en))
            : ""
        }
      >
        <BranchFormFields
          form={editForm}
          restaurants={restaurants}
          onSubmit={(v) =>
            editingBranch && updateMutation.mutate({ id: editingBranch.id, values: v })
          }
          isPending={updateMutation.isPending}
          submitLabel={t("common.save")}
          onCancel={() => {
            setEditingBranch(null);
            setEditBranchId(null);
          }}
          lockRestaurant
        />
      </FullScreenDialog>

      <ConfirmDialog
        open={Boolean(deletingBranch)}
        title={t("branches.delete")}
        description={t("branches.deleteDesc")}
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => !open && setDeletingBranch(null)}
        onConfirm={() => deletingBranch && deleteMutation.mutate(deletingBranch)}
      />
    </>
  );
}
