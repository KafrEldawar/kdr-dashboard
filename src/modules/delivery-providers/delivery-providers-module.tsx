"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Settings2, User } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { Modal } from "@/components/shared/modal";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";
import {
  deliveryProviderService,
  type DeliveryProvider,
  type DeliveryProviderKind,
} from "@/services/delivery";

const QUERY_KEY = ["delivery-providers"];

export function DeliveryProvidersModule() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DeliveryProvider | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => deliveryProviderService.list(),
  });

  const columns = useMemo<ColumnDef<DeliveryProvider>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "الحساب",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-medium">
                {p.display_name || p.full_name || "بدون اسم"}
              </span>
              <span className="text-xs text-muted-foreground">{p.phone ?? "—"}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "kind",
        header: "النوع",
        cell: ({ row }) => {
          const p = row.original;
          // A driver profile created before migration 067 would have no
          // row; the trigger covers new ones, so this should stay empty.
          if (!p.kind) return <Badge variant="destructive">غير مهيّأ</Badge>;
          return p.kind === "office" ? (
            <Badge variant="solid">
              <Building2 className="h-3 w-3" />
              مكتب
            </Badge>
          ) : (
            <Badge variant="outline">
              <User className="h-3 w-3" />
              طيار فردي
            </Badge>
          );
        },
      },
      {
        accessorKey: "max_concurrent_orders",
        header: "السعة",
        cell: ({ row }) => {
          const p = row.original;
          if (!p.kind) return "—";
          return (
            <span className="tabular-nums">
              {p.active_orders} / {p.max_concurrent_orders ?? 1}
            </span>
          );
        },
      },
      {
        accessorKey: "couriers",
        header: "الطيارين",
        cell: ({ row }) =>
          row.original.kind === "office" ? row.original.couriers : "—",
      },
      {
        accessorKey: "unsettled_amount",
        header: "فلوس لم تُحصّل",
        cell: ({ row }) => {
          const amount = row.original.unsettled_amount;
          if (amount <= 0) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="tabular-nums font-medium text-warning">
              {amount.toFixed(2)} ج
            </span>
          );
        },
      },
      {
        id: "status",
        header: "الحالة",
        cell: ({ row }) => {
          const p = row.original;
          if (p.is_active === false) return <Badge variant="destructive">موقوف</Badge>;
          return p.is_available ? (
            <Badge variant="success">متاح</Badge>
          ) : (
            <Badge variant="secondary">مغلق</Badge>
          );
        },
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => setEditing(row.original)}>
            <Settings2 className="h-4 w-4" />
            إعدادات
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="مكاتب وطيارين التوصيل"
        description="حوّل حساب طيار إلى مكتب توصيل واضبط عدد الطلبات اللي يقدر يمسكها في نفس الوقت. الطيار الفردي مثبّت على طلب واحد."
      />
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          description={toAppError(query.error).message}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {query.data ? (
        <DataTable
          columns={columns}
          data={query.data}
          emptyTitle="لا يوجد حسابات توصيل"
        />
      ) : null}

      <ProviderSettingsModal
        provider={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        }}
      />
    </>
  );
}

function ProviderSettingsModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: DeliveryProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<DeliveryProviderKind>("individual");
  const [displayName, setDisplayName] = useState("");
  const [maxOrders, setMaxOrders] = useState("10");
  const [isActive, setIsActive] = useState(true);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // Reset the form whenever a different row opens the modal.
  if (provider && hydratedFor !== provider.id) {
    setHydratedFor(provider.id);
    setKind(provider.kind ?? "individual");
    setDisplayName(provider.display_name ?? "");
    setMaxOrders(String(provider.max_concurrent_orders ?? 10));
    setIsActive(provider.is_active ?? true);
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!provider) throw new Error("لا يوجد حساب محدد");
      const parsed = parseInt(maxOrders, 10);
      if (kind === "office" && (Number.isNaN(parsed) || parsed < 1 || parsed > 50)) {
        throw new Error("السعة لازم تكون رقم بين 1 و 50");
      }
      return deliveryProviderService.upsert({
        profileId: provider.id,
        kind,
        displayName: displayName.trim() || null,
        maxConcurrentOrders: kind === "office" ? parsed : 1,
        isActive,
      });
    },
    onSuccess: () => {
      toast.success("تم حفظ إعدادات الحساب");
      onSaved();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const hasActiveOrders = (provider?.active_orders ?? 0) > 0;
  const parsedMax = parseInt(maxOrders, 10);
  // Lowering the ceiling under what's already held doesn't drop orders —
  // the server just refuses new claims until they drain — but the admin
  // should know that before saving.
  const shrinkingBelowLoad =
    kind === "office" && !Number.isNaN(parsedMax) && parsedMax < (provider?.active_orders ?? 0);

  return (
    <Modal
      open={provider !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={provider?.display_name || provider?.full_name || "إعدادات الحساب"}
      description="النوع والسعة يتغيّروا من هنا فقط — حساب المكتب مش بيقدر يرفع الحد بنفسه."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "جاري الحفظ…" : "حفظ"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>نوع الحساب</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={kind === "individual" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setKind("individual")}
            >
              <User className="h-4 w-4" />
              طيار فردي
            </Button>
            <Button
              type="button"
              variant={kind === "office" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setKind("office")}
            >
              <Building2 className="h-4 w-4" />
              مكتب توصيل
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {kind === "office"
              ? "المكتب بيستلم أكتر من طلب ويوزّعهم على طيارينه، وبيقدر يبعتلهم الطلب على واتساب."
              : "الطيار الفردي بياخد طلب واحد في المرة — الحد مثبّت على 1 في قاعدة البيانات."}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="display-name">اسم المكتب / الطيار (اختياري)</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={provider?.full_name ?? "الاسم التجاري"}
          />
        </div>

        {kind === "office" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="max-orders">أقصى عدد طلبات في نفس الوقت</Label>
            <Input
              id="max-orders"
              type="number"
              min={1}
              max={50}
              value={maxOrders}
              onChange={(e) => setMaxOrders(e.target.value)}
            />
            {shrinkingBelowLoad ? (
              <p className="text-xs text-warning">
                المكتب ماسك {provider?.active_orders} طلب دلوقتي. الطلبات دي مش هتتلغي،
                بس مش هيقدر يستلم جديد لحد ما ينزل تحت الحد.
              </p>
            ) : null}
          </div>
        ) : hasActiveOrders && provider?.kind === "office" ? (
          <p className="text-xs text-warning">
            المكتب ماسك {provider.active_orders} طلب. تحويله لطيار فردي هينزّل الحد لـ 1
            فمش هيقدر يستلم جديد قبل ما يسلّمهم.
          </p>
        ) : null}

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">الحساب مفعّل</span>
            <span className="text-xs text-muted-foreground">
              الإيقاف بيمنع استلام طلبات جديدة من غير حذف الحساب.
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant={isActive ? "default" : "outline"}
            onClick={() => setIsActive((v) => !v)}
          >
            {isActive ? "مفعّل" : "موقوف"}
          </Button>
        </div>

        {(provider?.unsettled_amount ?? 0) > 0 ? (
          <p className="text-xs text-warning">
            على الحساب ده {provider?.unsettled_amount.toFixed(2)} جنيه لم تُحصّل بعد.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
