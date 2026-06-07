"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit, Eye, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { usersService } from "@/services/users";
import type { RestaurantOption } from "@/services/users";
import { useTranslations, useLocale } from "@/lib/i18n";
import type { Profile, UserRole } from "@/types/database";

const createUserSchema = z
  .object({
    full_name: z.string().min(2, "اكتب اسم واضح"),
    email: z.string().email("اكتب بريد صحيح"),
    phone: z.string().optional(),
    role: z.enum(["customer", "restaurant", "admin"]),
    password: z.string().min(6, "كلمة المرور لازم تكون 6 حروف على الأقل"),
    restaurant_id: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "restaurant" && !data.restaurant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "لازم تختار المطعم المرتبط بصاحب المطعم دا",
        path: ["restaurant_id"],
      });
    }
  });

const editUserSchema = z.object({
  full_name: z.string().min(2, "اكتب اسم واضح"),
  phone: z.string().optional(),
  role: z.enum(["customer", "restaurant", "admin"]),
  is_active: z.boolean(),
  restaurant_id: z.string().optional(),
});

type CreateUserForm = z.infer<typeof createUserSchema>;
type EditUserForm = z.infer<typeof editUserSchema>;

function roleBadgeVariant(role: string) {
  if (role === "admin") return "default" as const;
  if (role === "restaurant") return "secondary" as const;
  return "outline" as const;
}

const roleOptions: { value: UserRole | "all"; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "customer", label: "عميل" },
  { value: "restaurant", label: "مطعم" },
  { value: "admin", label: "أدمن" },
];

export function UsersModule() {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const usersQuery = useQuery({
    queryKey: ["users", debouncedSearch, roleFilter],
    queryFn: () =>
      usersService.getAll({
        search: debouncedSearch,
        filters: roleFilter === "all" ? undefined : { role: roleFilter },
        pageSize: 50,
      }),
  });

  const relatedOrdersQuery = useQuery({
    queryKey: ["users", selectedUser?.id, "orders"],
    queryFn: () => usersService.getRelatedOrders(selectedUser!.id),
    enabled: Boolean(selectedUser),
  });

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-for-owner-select"],
    queryFn: () => usersService.getRestaurantsForOwnerSelect(),
  });

  const createForm = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { full_name: "", email: "", phone: "", role: "customer", password: "Test123456", restaurant_id: "" },
  });

  const editForm = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { full_name: "", phone: "", role: "customer", is_active: true, restaurant_id: "" },
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["users"] });

  const createMutation = useMutation({
    mutationFn: async (values: CreateUserForm) => {
      const result = await usersService.createTestUser({
        full_name: values.full_name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        password: values.password,
      });
      if (values.role === "restaurant" && values.restaurant_id) {
        await usersService.linkOwnerToRestaurant(result.data.id, values.restaurant_id);
      }
      return result;
    },
    onSuccess: () => {
      toast.success(t("users.createdSuccess"));
      createForm.reset({ full_name: "", email: "", phone: "", role: "customer", password: "Test123456", restaurant_id: "" });
      void queryClient.invalidateQueries({ queryKey: ["restaurants-for-owner-select"] });
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values, previousRole }: { id: string; values: EditUserForm; previousRole: UserRole }) => {
      if (values.role === "restaurant" && previousRole !== "restaurant") {
        if (!values.restaurant_id) throw new Error("لازم تختار المطعم المرتبط بصاحب المطعم دا");
        await usersService.update(id, {
          full_name: values.full_name,
          phone: values.phone || null,
          is_active: values.is_active,
        });
        await usersService.linkOwnerToRestaurant(id, values.restaurant_id);
        void queryClient.invalidateQueries({ queryKey: ["restaurants-for-owner-select"] });
        return;
      }
      return usersService.update(id, {
        full_name: values.full_name,
        phone: values.phone || null,
        role: values.role,
        is_active: values.is_active,
      });
    },
    onSuccess: () => {
      toast.success(t("users.updatedSuccess"));
      setEditingUser(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (user: Profile) => usersService.toggleActive(user),
    onSuccess: () => {
      toast.success("تم تحديث حالة المستخدم");
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const columns = useMemo<ColumnDef<Profile>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: t("users.field.name"),
        cell: ({ row }) => row.original.full_name || "—",
      },
      {
        accessorKey: "phone",
        header: t("users.field.phone"),
        cell: ({ row }) => row.original.phone || "—",
      },
      {
        accessorKey: "role",
        header: t("users.field.role"),
        cell: ({ row }) => (
          <Badge variant={roleBadgeVariant(row.original.role)}>
            {roleOptions.find((o) => o.value === row.original.role)?.label ?? row.original.role}
          </Badge>
        ),
      },
      {
        accessorKey: "is_active",
        header: "الحالة",
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "default" : "destructive"}>
            {row.original.is_active ? "نشط" : "محظور"}
          </Badge>
        ),
      },
      {
        accessorKey: "created_at",
        header: t("users.field.createdAt"),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
      {
        id: "actions",
        header: t("users.field.actions"),
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelectedUser(user)}>
                <Eye className="h-4 w-4" />
                {t("common.view")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingUser(user);
                  editForm.reset({
                    full_name: user.full_name ?? "",
                    phone: user.phone ?? "",
                    role: user.role,
                    is_active: user.is_active,
                    restaurant_id: "",
                  });
                }}
              >
                <Edit className="h-4 w-4" />
                {t("common.edit")}
              </Button>
              <Button
                size="sm"
                variant={user.is_active ? "destructive" : "secondary"}
                onClick={() => toggleActiveMutation.mutate(user)}
              >
                <ShieldCheck className="h-4 w-4" />
                {user.is_active ? "حظر" : "تفعيل"}
              </Button>
            </div>
          );
        },
      },
    ],
    [t, locale, editForm, toggleActiveMutation]
  );

  return (
    <>
      <PageHeader title={t("users.title")} description={t("users.description")} />

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              {t("users.createTestUser")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))}
            >
              <FormField label="الاسم الكامل" error={createForm.formState.errors.full_name?.message}>
                <Input {...createForm.register("full_name")} placeholder="محمد أحمد" />
              </FormField>
              <FormField label="البريد الإلكتروني" error={createForm.formState.errors.email?.message}>
                <Input {...createForm.register("email")} dir="ltr" placeholder="test@example.com" />
              </FormField>
              <FormField label="رقم الموبايل">
                <Input {...createForm.register("phone")} dir="ltr" placeholder="01000000000" />
              </FormField>
              <FormField label="الدور" error={createForm.formState.errors.role?.message}>
                <Select
                  value={createForm.watch("role")}
                  onValueChange={(v) => {
                    createForm.setValue("role", v as UserRole);
                    createForm.setValue("restaurant_id", "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">عميل</SelectItem>
                    <SelectItem value="restaurant">مطعم</SelectItem>
                    <SelectItem value="admin">أدمن</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {createForm.watch("role") === "restaurant" ? (
                <FormField
                  label="المطعم المرتبط"
                  error={(createForm.formState.errors as Record<string, { message?: string }>).restaurant_id?.message}
                >
                  <Select
                    value={createForm.watch("restaurant_id") ?? ""}
                    onValueChange={(v) => createForm.setValue("restaurant_id", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختار المطعم..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(restaurantsQuery.data ?? []).map((r: RestaurantOption) => (
                        <SelectItem
                          key={r.id}
                          value={r.id}
                          disabled={r.ownerUserId !== null}
                        >
                          {r.name_ar}
                          {r.ownerUserId !== null ? " (مرتبط بصاحب)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ) : null}
              <FormField label="كلمة المرور" error={createForm.formState.errors.password?.message}>
                <Input {...createForm.register("password")} dir="ltr" type="text" />
              </FormField>
              <Button className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? t("common.creating") : t("users.createBtn")}
              </Button>
            </form>
            <p className="mt-3 text-xs text-muted-foreground">
              البروفايل يُنشأ تلقائياً بعد التسجيل عبر trigger في قاعدة البيانات.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-center md:justify-between">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t("users.searchPlaceholder")}
            />
            <div className="w-full md:w-48">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {usersQuery.isLoading ? <LoadingState /> : null}
          {usersQuery.isError ? (
            <ErrorState
              description={toAppError(usersQuery.error).message}
              onRetry={() => usersQuery.refetch()}
            />
          ) : null}
          {usersQuery.data ? (
            <DataTable
              columns={columns}
              data={usersQuery.data.data}
              emptyTitle={t("users.noUsers")}
            />
          ) : null}
        </div>
      </div>

      {editingUser ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">{t("users.editUser")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={editForm.handleSubmit((v) =>
                updateMutation.mutate({ id: editingUser.id, values: v, previousRole: editingUser.role })
              )}
            >
              <FormField label="الاسم الكامل" error={editForm.formState.errors.full_name?.message}>
                <Input {...editForm.register("full_name")} />
              </FormField>
              <FormField label="رقم الموبايل">
                <Input {...editForm.register("phone")} dir="ltr" />
              </FormField>
              <FormField label="الدور" error={editForm.formState.errors.role?.message}>
                <Select
                  value={editForm.watch("role")}
                  onValueChange={(v) => {
                    editForm.setValue("role", v as UserRole);
                    editForm.setValue("restaurant_id", "");
                  }}
                  disabled={editingUser?.role === "restaurant"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">عميل</SelectItem>
                    <SelectItem value="restaurant">مطعم</SelectItem>
                    <SelectItem value="admin">أدمن</SelectItem>
                  </SelectContent>
                </Select>
                {editingUser?.role === "restaurant" ? (
                  <p className="text-xs text-muted-foreground">الدور مرتبط بمطعم — غيّره من صفحة المطعم</p>
                ) : null}
              </FormField>
              {editingUser?.role !== "restaurant" && editForm.watch("role") === "restaurant" ? (
                <div className="md:col-span-2">
                  <FormField
                    label="المطعم المرتبط"
                    error={(editForm.formState.errors as Record<string, { message?: string }>).restaurant_id?.message}
                  >
                    <Select
                      value={editForm.watch("restaurant_id") ?? ""}
                      onValueChange={(v) => editForm.setValue("restaurant_id", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختار المطعم..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(restaurantsQuery.data ?? []).map((r: RestaurantOption) => (
                          <SelectItem
                            key={r.id}
                            value={r.id}
                            disabled={r.ownerUserId !== null}
                          >
                            {r.name_ar}
                            {r.ownerUserId !== null ? " (مرتبط بصاحب)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              ) : null}
              {editingUser?.role === "restaurant" ? (
                <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="font-semibold">المطعم المرتبط: </span>
                  {restaurantsQuery.data?.find((r: RestaurantOption) => r.ownerUserId === editingUser.id)?.name_ar ?? "غير محدد"}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...editForm.register("is_active")}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label>نشط</Label>
              </div>
              <div className="flex gap-3 md:col-span-2">
                <Button disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? t("common.saving") : t("common.save")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {selectedUser ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              {t("users.relatedData")}: {selectedUser.full_name || selectedUser.id}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
              <p><span className="font-semibold">الاسم: </span>{selectedUser.full_name || "—"}</p>
              <p><span className="font-semibold">الموبايل: </span>{selectedUser.phone || "—"}</p>
              <p><span className="font-semibold">الدور: </span>{selectedUser.role}</p>
              {selectedUser.role === "restaurant" ? (
                <p>
                  <span className="font-semibold">المطعم المرتبط: </span>
                  {restaurantsQuery.data?.find((r: RestaurantOption) => r.ownerUserId === selectedUser.id)?.name_ar ?? "غير محدد"}
                </p>
              ) : null}
              <p><span className="font-semibold">الجنس: </span>{selectedUser.gender || "—"}</p>
              <p><span className="font-semibold">نشط: </span>{selectedUser.is_active ? "✅" : "❌"}</p>
            </div>
            <p className="mb-2 font-semibold text-sm">آخر 10 طلبات:</p>
            {relatedOrdersQuery.isLoading ? <LoadingState /> : null}
            {relatedOrdersQuery.data && relatedOrdersQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا يوجد طلبات</p>
            ) : null}
            {relatedOrdersQuery.data && relatedOrdersQuery.data.length > 0 ? (
              <div className="space-y-2">
                {relatedOrdersQuery.data.map((order: {id: string; status: string; total_amount: number; created_at: string}) => (
                  <div key={order.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <span>{order.status}</span>
                    <span>{order.total_amount} ج.م</span>
                    <span className="text-muted-foreground">{formatDate(order.created_at, locale)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

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
