"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Edit, Eye, ShieldCheck, Trash2, UserPlus, XCircle } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Modal } from "@/components/shared/modal";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService, type AdminUser } from "@/services/admin";
import type { RestaurantOption } from "@/services/users";
import { usersService } from "@/services/users";
import { useTranslations, useLocale } from "@/lib/i18n";
import type { UserRole } from "@/types/database";
import { createUserAction, deleteUserAction } from "@/app/users/actions";

const createUserSchema = z
  .object({
    full_name: z.string().min(2, "اكتب اسم واضح"),
    email: z.string().email("اكتب بريد صحيح"),
    phone: z.string().optional(),
    role: z.enum(["customer", "restaurant", "driver", "admin"]),
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
  role: z.enum(["customer", "restaurant", "driver", "admin"]),
  is_active: z.boolean(),
  whatsapp_opt_in: z.boolean(),
  restaurant_id: z.string().optional(),
});

type CreateUserForm = z.infer<typeof createUserSchema>;
type EditUserForm = z.infer<typeof editUserSchema>;

function roleBadgeVariant(role: string) {
  if (role === "admin") return "solid" as const;
  if (role === "restaurant") return "secondary" as const;
  return "outline" as const;
}

const roleOptions: { value: UserRole | "all"; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "customer", label: "عميل" },
  { value: "restaurant", label: "مطعم" },
  { value: "driver", label: "مندوب" },
  { value: "admin", label: "أدمن" },
];

export function UsersModule() {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const usersQuery = useQuery({
    queryKey: ["users", debouncedSearch, roleFilter],
    queryFn: () =>
      adminService.listUsers({
        search: debouncedSearch || undefined,
        role: roleFilter === "all" ? undefined : roleFilter,
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

  const createDefaults: CreateUserForm = {
    full_name: "",
    email: "",
    phone: "",
    role: "customer",
    password: "Test123456",
    restaurant_id: "",
  };

  const createForm = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: createDefaults,
  });

  const editForm = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      full_name: "",
      phone: "",
      role: "customer",
      is_active: true,
      whatsapp_opt_in: true,
      restaurant_id: "",
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      createForm.reset(createDefaults);
      setAddOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["users"] });

  const createMutation = useMutation({
    mutationFn: async (values: CreateUserForm) => {
      const result = await createUserAction({
        full_name: values.full_name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        password: values.password,
      });
      if (result.error) throw new Error(result.error);
      if (values.role === "restaurant" && values.restaurant_id && result.userId) {
        await usersService.linkOwnerToRestaurant(result.userId, values.restaurant_id);
      }
      return result;
    },
    onSuccess: () => {
      toast.success(t("users.createdSuccess"));
      createForm.reset(createDefaults);
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["restaurants-for-owner-select"] });
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      values,
      previousRole,
    }: {
      id: string;
      values: EditUserForm;
      previousRole: UserRole;
    }) => {
      if (values.role === "restaurant" && previousRole !== "restaurant") {
        if (!values.restaurant_id)
          throw new Error("لازم تختار المطعم المرتبط بصاحب المطعم دا");
        await adminService.updateUser({
          userId: id,
          fullName: values.full_name,
          phone: values.phone || undefined,
          isActive: values.is_active,
          whatsappOptIn: values.whatsapp_opt_in,
        });
        await usersService.linkOwnerToRestaurant(id, values.restaurant_id);
        void queryClient.invalidateQueries({
          queryKey: ["restaurants-for-owner-select"],
        });
        return;
      }
      return adminService.updateUser({
        userId: id,
        fullName: values.full_name,
        phone: values.phone || undefined,
        role: values.role,
        isActive: values.is_active,
        whatsappOptIn: values.whatsapp_opt_in,
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
    mutationFn: (user: AdminUser) =>
      adminService.updateUser({ userId: user.id, isActive: !user.is_active }),
    onSuccess: () => {
      toast.success("تم تحديث حالة المستخدم");
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (user: AdminUser) => {
      const result = await deleteUserAction(user.id);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success("تم حذف المستخدم نهائياً");
      setUserToDelete(null);
      if (selectedUser?.id === userToDelete?.id) setSelectedUser(null);
      if (editingUser?.id === userToDelete?.id) setEditingUser(null);
      refresh();
    },
    onError: (error) => {
      toast.error(toAppError(error).message);
      setUserToDelete(null);
    },
  });

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: t("users.field.name"),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.full_name || "—"}</span>
        ),
      },
      {
        accessorKey: "phone",
        header: t("users.field.phone"),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span dir="ltr">{row.original.phone || "—"}</span>
            {row.original.phone ? (
              row.original.phone_verified_at ? (
                <span
                  title="رقم موثّق"
                  className="inline-flex items-center gap-1 text-emerald-600"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </span>
              ) : (
                <span
                  title="غير موثّق"
                  className="inline-flex items-center gap-1 text-muted-foreground"
                >
                  <XCircle className="h-4 w-4" />
                </span>
              )
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "whatsapp_opt_in",
        header: "واتساب",
        cell: ({ row }) => (
          <Badge variant={row.original.whatsapp_opt_in ? "success" : "secondary"}>
            {row.original.whatsapp_opt_in ? "مشترك" : "متوقف"}
          </Badge>
        ),
      },
      {
        accessorKey: "role",
        header: t("users.field.role"),
        cell: ({ row }) => (
          <Badge variant={roleBadgeVariant(row.original.role)}>
            {roleOptions.find((o) => o.value === row.original.role)?.label ??
              row.original.role}
          </Badge>
        ),
      },
      {
        accessorKey: "is_active",
        header: "الحالة",
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "success" : "secondary"}>
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
                    whatsapp_opt_in: user.whatsapp_opt_in,
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
              <Button size="sm" variant="destructive" onClick={() => setUserToDelete(user)}>
                <Trash2 className="h-4 w-4" />
                حذف
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
      <PageHeader
        icon={UserPlus}
        title={t("users.title")}
        description={t("users.description")}
        action={
          <Button
            onClick={() => {
              createForm.reset(createDefaults);
              setAddOpen(true);
            }}
          >
            <UserPlus className="h-4 w-4" />
            {t("users.createBtn")}
          </Button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
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

      {/* List */}
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
          data={usersQuery.data.data ?? []}
          emptyTitle={t("users.noUsers")}
        />
      ) : null}

      {/* ── Create user (modal) ─────────────────────────────────── */}
      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("users.createTestUser")}
        description={t("users.createTestUserNote")}
        size="md"
      >
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
                <SelectItem value="driver">مندوب</SelectItem>
                <SelectItem value="admin">أدمن</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {createForm.watch("role") === "restaurant" ? (
            <FormField
              label="المطعم المرتبط"
              error={
                (createForm.formState.errors as Record<string, { message?: string }>)
                  .restaurant_id?.message
              }
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
                    <SelectItem key={r.id} value={r.id} disabled={r.ownerUserId !== null}>
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
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={createMutation.isPending}>
              {createMutation.isPending ? t("common.creating") : t("users.createBtn")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Edit user (modal) ───────────────────────────────────── */}
      <Modal
        open={Boolean(editingUser)}
        onOpenChange={(open) => !open && setEditingUser(null)}
        title={t("users.editUser")}
        description={editingUser?.full_name ?? ""}
        size="md"
      >
        {editingUser ? (
          <form
            className="space-y-4"
            onSubmit={editForm.handleSubmit((v) =>
              updateMutation.mutate({
                id: editingUser.id,
                values: v,
                previousRole: editingUser.role,
              })
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
                  <SelectItem value="driver">مندوب</SelectItem>
                  <SelectItem value="admin">أدمن</SelectItem>
                </SelectContent>
              </Select>
              {editingUser?.role === "restaurant" ? (
                <p className="text-xs text-muted-foreground">
                  الدور مرتبط بمطعم — غيّره من صفحة المطعم
                </p>
              ) : null}
            </FormField>
            {editingUser?.role !== "restaurant" &&
            editForm.watch("role") === "restaurant" ? (
              <FormField
                label="المطعم المرتبط"
                error={
                  (editForm.formState.errors as Record<string, { message?: string }>)
                    .restaurant_id?.message
                }
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
                      <SelectItem key={r.id} value={r.id} disabled={r.ownerUserId !== null}>
                        {r.name_ar}
                        {r.ownerUserId !== null ? " (مرتبط بصاحب)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
            {editingUser?.role === "restaurant" ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <span className="font-semibold">المطعم المرتبط: </span>
                {editingUser.restaurant?.name_ar ?? "غير محدد"}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                {...editForm.register("is_active")}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <Label>نشط</Label>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
              <div>
                <Label>الاشتراك في رسائل واتساب التسويقية</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  لو متوقف، الحملات هتتخطّى المستخدم تلقائياً.
                </p>
              </div>
              <input
                type="checkbox"
                {...editForm.register("whatsapp_opt_in")}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                {t("common.cancel")}
              </Button>
              <Button disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* ── User detail (modal) ─────────────────────────────────── */}
      <Modal
        open={Boolean(selectedUser)}
        onOpenChange={(open) => !open && setSelectedUser(null)}
        title={t("users.relatedData")}
        description={selectedUser?.full_name || selectedUser?.id}
        size="md"
      >
        {selectedUser ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <DetailItem label="الاسم" value={selectedUser.full_name || "—"} />
              <DetailItem
                label="الموبايل"
                value={
                  selectedUser.phone
                    ? `${selectedUser.phone} ${selectedUser.phone_verified_at ? "✓ موثّق" : "(غير موثّق)"}`
                    : "—"
                }
                dir="ltr"
              />
              <DetailItem
                label="اشتراك واتساب"
                value={selectedUser.whatsapp_opt_in ? "مشترك" : "متوقف"}
              />
              <DetailItem
                label="الدور"
                value={roleOptions.find((o) => o.value === selectedUser.role)?.label ?? selectedUser.role}
              />
              <DetailItem label="الجنس" value={selectedUser.gender || "—"} />
              {selectedUser.role === "restaurant" ? (
                <DetailItem
                  label="المطعم المرتبط"
                  value={selectedUser.restaurant?.name_ar ?? "غير محدد"}
                />
              ) : null}
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">الحالة</p>
                <div className="mt-1">
                  <Badge variant={selectedUser.is_active ? "success" : "secondary"}>
                    {selectedUser.is_active ? "نشط" : "محظور"}
                  </Badge>
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-bold">آخر 10 طلبات</p>
              {relatedOrdersQuery.isLoading ? <LoadingState /> : null}
              {relatedOrdersQuery.data && relatedOrdersQuery.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا يوجد طلبات</p>
              ) : null}
              {relatedOrdersQuery.data && relatedOrdersQuery.data.length > 0 ? (
                <div className="space-y-2">
                  {relatedOrdersQuery.data.map(
                    (order: {
                      id: string;
                      status: string;
                      total_amount: number;
                      created_at: string;
                    }) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm"
                      >
                        <Badge variant="outline">{order.status}</Badge>
                        <span className="font-semibold">{order.total_amount} ج.م</span>
                        <span className="text-muted-foreground">
                          {formatDate(order.created_at, locale)}
                        </span>
                      </div>
                    )
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Delete confirmation dialog ────────────────────────── */}
      <AlertDialog
        open={Boolean(userToDelete)}
        onOpenChange={(open: boolean) => {
          if (!open) setUserToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المستخدم نهائياً</AlertDialogTitle>
            <AlertDialogDescription>
              هتحذف{" "}
              <span className="font-semibold text-foreground">
                {userToDelete?.full_name || userToDelete?.id}
              </span>{" "}
              نهائياً من قاعدة البيانات. العملية دي مش قابلة للرجوع — كل
              البيانات المرتبطة (طلباته، جهازه، وبروفايله) هتتمسح.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (userToDelete) deleteMutation.mutate(userToDelete);
              }}
            >
              {deleteMutation.isPending ? "جاري الحذف..." : "حذف نهائي"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DetailItem({
  label,
  value,
  dir,
}: {
  label: string;
  value: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold" dir={dir}>
        {value}
      </p>
    </div>
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
