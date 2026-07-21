"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, X, Clock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as Dialog from "@radix-ui/react-dialog";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";
import { menuBadgeLabel } from "@/lib/menu-badges";
import {
  menuItemRequestsService,
  type MenuItemRequest,
  type MenuItemRequestStatus,
} from "@/services/menu-item-requests/menu-item-requests.service";

const statusLabels: Record<MenuItemRequestStatus | "all", string> = {
  all: "الكل",
  pending: "قيد المراجعة",
  approved: "مقبول",
  rejected: "مرفوض",
};

const actionLabels: Record<"create" | "update", string> = {
  create: "إضافة صنف",
  update: "تعديل صنف",
};

function StatusBadge({ status }: { status: MenuItemRequestStatus }) {
  const variants: Record<MenuItemRequestStatus, "default" | "secondary" | "destructive"> = {
    pending: "secondary",
    approved: "default",
    rejected: "destructive",
  };
  return (
    <Badge variant={variants[status]}>{statusLabels[status]}</Badge>
  );
}

type ReviewDialogProps = {
  request: MenuItemRequest;
  open: boolean;
  onClose: () => void;
  onConfirm: (status: "approved" | "rejected", note: string) => void;
  isPending: boolean;
};

function ReviewDialog({ request, open, onClose, onConfirm, isPending }: ReviewDialogProps) {
  const [adminNote, setAdminNote] = useState("");
  const [action, setAction] = useState<"approved" | "rejected">("approved");

  const proposedName =
    (request.proposed_data?.name_ar as string) ||
    (request.proposed_data?.name_en as string) ||
    "—";
  const proposedPrice = request.proposed_data?.price
    ? `${request.proposed_data.price} ج.م`
    : "—";
  const proposedBadge = menuBadgeLabel(
    request.proposed_data?.badge_type as string | undefined,
    request.proposed_data?.badge_label_ar as string | undefined
  );
  const proposedCustomCategory =
    (request.proposed_data?.custom_category_ar as string | undefined)?.trim() ||
    null;

  return (
    <Dialog.Root open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg"
          dir="rtl"
        >
          <Dialog.Title className="mb-4 text-lg font-semibold">
            مراجعة طلب {actionLabels[request.action]}
          </Dialog.Title>

          <div className="space-y-4 text-sm">
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <p>
                <span className="font-medium">المطعم:</span>{" "}
                {request.restaurant_name_ar}
              </p>
              <p>
                <span className="font-medium">الطلب:</span>{" "}
                {actionLabels[request.action]}
              </p>
              <p>
                <span className="font-medium">الاسم المقترح:</span> {proposedName}
              </p>
              <p>
                <span className="font-medium">السعر المقترح:</span> {proposedPrice}
              </p>
              {proposedBadge && (
                <p>
                  <span className="font-medium">البادج المقترح:</span>{" "}
                  {proposedBadge}
                </p>
              )}
              {proposedCustomCategory && (
                <p>
                  <span className="font-medium">تصنيف جديد مقترح:</span>{" "}
                  {proposedCustomCategory}{" "}
                  <span className="text-muted-foreground">
                    (سيُضاف لقائمة التصنيفات عند القبول)
                  </span>
                </p>
              )}
              {request.current_item && (
                <p className="text-muted-foreground">
                  الصنف الحالي: {request.current_item.name_ar} (
                  {request.current_item.price} ج.م)
                </p>
              )}
              {request.owner_note && (
                <p>
                  <span className="font-medium">ملاحظة الأونر:</span>{" "}
                  {request.owner_note}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>القرار</Label>
              <Select
                value={action}
                onValueChange={(v) => setAction(v as "approved" | "rejected")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">✓ قبول</SelectItem>
                  <SelectItem value="rejected">✗ رفض</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>ملاحظة الإدارة (اختياري)</Label>
              <Textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="سبب القبول أو الرفض..."
                rows={3}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button
              disabled={isPending}
              variant={action === "approved" ? "default" : "destructive"}
              onClick={() => onConfirm(action, adminNote)}
            >
              {isPending
                ? "جاري…"
                : action === "approved"
                ? "قبول الطلب"
                : "رفض الطلب"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function MenuItemRequestsModule() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<MenuItemRequestStatus | "all">("pending");
  const [reviewing, setReviewing] = useState<MenuItemRequest | null>(null);

  const requestsQuery = useQuery({
    queryKey: ["menu-item-requests", statusFilter],
    queryFn: () => menuItemRequestsService.getRequests({ status: statusFilter, pageSize: 50 }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: "approved" | "rejected"; note: string }) =>
      menuItemRequestsService.reviewRequest({ requestId: id, status, adminNote: note }),
    onSuccess: (_, vars) => {
      toast.success(vars.status === "approved" ? "تم قبول الطلب وتطبيق التعديل" : "تم رفض الطلب");
      setReviewing(null);
      void queryClient.invalidateQueries({ queryKey: ["menu-item-requests"] });
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const columns: ColumnDef<MenuItemRequest>[] = [
    {
      accessorKey: "restaurant_name_ar",
      header: "المطعم",
    },
    {
      accessorKey: "action",
      header: "نوع الطلب",
      cell: ({ row }) => actionLabels[row.original.action],
    },
    {
      id: "proposed_name",
      header: "الصنف المقترح",
      cell: ({ row }) => {
        const data = row.original.proposed_data;
        return (data?.name_ar as string) || (data?.name_en as string) || "—";
      },
    },
    {
      id: "proposed_price",
      header: "السعر",
      cell: ({ row }) => {
        const price = row.original.proposed_data?.price;
        return price ? `${price} ج.م` : "—";
      },
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "created_at",
      header: "تاريخ الطلب",
      cell: ({ row }) =>
        new Date(row.original.created_at).toLocaleDateString("ar-EG"),
    },
    {
      id: "actions",
      header: "الإجراء",
      cell: ({ row }) => {
        const req = row.original;
        if (req.status !== "pending") return null;
        return (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setReviewing(req)}
            >
              <Clock className="me-1 h-3 w-3" />
              مراجعة
            </Button>
          </div>
        );
      },
    },
  ];

  const requests = requestsQuery.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="طلبات تعديل المنيو"
        description="طلبات الإضافة والتعديل المرسلة من أصحاب المطاعم — راجعها وافق أو ارفض."
      />

      <div className="mb-4 flex items-center gap-3 rounded-lg border bg-background p-3">
        <span className="text-sm font-medium">الحالة:</span>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as MenuItemRequestStatus | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["pending", "approved", "rejected", "all"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {statusFilter === "pending" && requestsQuery.data && (
          <Badge variant="secondary">
            {requestsQuery.data.meta.total} طلب معلق
          </Badge>
        )}
      </div>

      {requestsQuery.isLoading ? <LoadingState /> : null}
      {requestsQuery.isError ? (
        <ErrorState
          description={toAppError(requestsQuery.error).message}
          onRetry={() => requestsQuery.refetch()}
        />
      ) : null}
      {requestsQuery.data ? (
        <DataTable
          columns={columns}
          data={requests}
          emptyTitle="لا توجد طلبات"
        />
      ) : null}

      {reviewing && (
        <ReviewDialog
          request={reviewing}
          open={Boolean(reviewing)}
          onClose={() => setReviewing(null)}
          onConfirm={(status, note) =>
            reviewMutation.mutate({ id: reviewing.id, status, note })
          }
          isPending={reviewMutation.isPending}
        />
      )}
    </>
  );
}
