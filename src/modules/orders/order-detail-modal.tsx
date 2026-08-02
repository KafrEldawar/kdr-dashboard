"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bike,
  Check,
  ClipboardList,
  MapPin,
  Package,
  Phone,
  Receipt,
  Star,
  Store,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/shared/modal";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { OrderRouteMap } from "@/components/maps/order-route-map";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { adminService, type OrderDetail } from "@/services/admin";
import { useLocale } from "@/lib/i18n";
import type { OrderStatus } from "@/types/database";
import {
  allowedTransitions,
  OrderStatusBadge,
  SelfDeliveryBadge,
  STATUS_LABELS,
  STATUS_STYLE,
} from "./order-status";

const EGP = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v).toFixed(2)} ج.م`;

/**
 * The five points every order passes through. `pickup` orders and
 * self-delivery orders never get a driver, so the two driver stages
 * are dropped for them rather than rendered as permanently pending —
 * a stage that can never happen isn't useful to stare at.
 */
function milestoneSteps(order: OrderDetail) {
  const m = order.milestones;
  const hasDriverLeg =
    order.order_type === "delivery" && !order.delivery_by_owner;

  const steps: {
    key: string;
    label: string;
    at: string | null;
    minutes: number | null;
    minutesLabel: string;
  }[] = [
    {
      key: "created",
      label: "أُنشئ الطلب",
      at: m.created_at,
      minutes: null,
      minutesLabel: "",
    },
    {
      key: "accepted",
      label: "قبله المطعم",
      at: m.accepted_at,
      minutes: m.minutes_to_accept,
      minutesLabel: "من الإنشاء",
    },
  ];

  if (hasDriverLeg) {
    steps.push({
      key: "claimed",
      label: "استلمه مندوب",
      at: m.claimed_at,
      minutes: m.minutes_to_claim,
      minutesLabel: "من القبول",
    });
  }

  steps.push({
    key: "picked_up",
    label: hasDriverLeg ? "خرج من المطعم" : "خرج للتسليم",
    at: m.picked_up_at,
    minutes: m.minutes_to_pickup,
    minutesLabel: hasDriverLeg ? "من استلام المندوب" : "من القبول",
  });

  steps.push({
    key: "delivered",
    label:
      order.order_type === "pickup" ? "استلمه العميل" : "وصل للعميل",
    at: m.delivered_at,
    minutes: m.minutes_to_deliver,
    minutesLabel: "من الخروج",
  });

  return steps;
}

function MilestoneTrack({ order }: { order: OrderDetail }) {
  const steps = milestoneSteps(order);
  const locale = useLocale();

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <ClipboardList className="h-4 w-4" />
          مسار الطلب
        </p>
        {order.milestones.minutes_total != null ? (
          <Badge variant="outline" className="tabular-nums">
            الإجمالي {order.milestones.minutes_total} دقيقة
          </Badge>
        ) : null}
      </div>

      <ol className="space-y-0">
        {steps.map((step, i) => {
          const done = Boolean(step.at);
          const isLast = i === steps.length - 1;
          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                    done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-dashed border-muted-foreground/40 bg-background",
                  )}
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
                {!isLast ? (
                  <span
                    className={cn(
                      "w-0.5 flex-1 min-h-[28px]",
                      done ? "bg-emerald-500/40" : "bg-border",
                    )}
                  />
                ) : null}
              </div>

              <div className={cn("flex-1", !isLast && "pb-4")}>
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      !done && "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </p>
                  {step.minutes != null ? (
                    <Badge variant="secondary" className="tabular-nums text-[11px]">
                      +{step.minutes} د {step.minutesLabel}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {done ? formatDate(step.at, locale) : "لم يحدث بعد"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Icon className="h-4 w-4" />
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  dir,
  className,
}: {
  label: string;
  value: React.ReactNode;
  dir?: "ltr" | "rtl";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-muted/30 p-2.5", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium" dir={dir}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function MoneyRow({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string;
  tone?: "muted" | "positive" | "negative";
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-1.5 text-sm",
        bold && "border-t border-border pt-2 font-extrabold",
      )}
    >
      <span className={cn(tone === "muted" && "text-muted-foreground")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          tone === "positive" && "text-emerald-600 dark:text-emerald-400",
          tone === "negative" && "text-red-600 dark:text-red-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function OrderDetailModal({
  orderId,
  onClose,
  onUpdated,
}: {
  orderId: string | null;
  onClose: () => void;
  /** Fired after a successful status change so lists can refetch. */
  onUpdated?: () => void;
}) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");

  const detailQuery = useQuery({
    queryKey: ["order-detail", orderId],
    queryFn: () => adminService.getOrderDetail(orderId!),
    enabled: Boolean(orderId),
    retry: false,
  });

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) =>
      adminService.updateOrderStatus({
        orderId: orderId!,
        status,
        notes: note.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(
        `تم التحديث: ${STATUS_LABELS[result.from as OrderStatus] ?? result.from} ← ${
          STATUS_LABELS[result.to as OrderStatus] ?? result.to
        }`,
      );
      setPendingStatus(null);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["order-detail", orderId] });
      onUpdated?.();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const order = detailQuery.data;
  const transitions = order
    ? allowedTransitions(order.status as OrderStatus, order.order_type)
    : [];

  const close = () => {
    setPendingStatus(null);
    setNote("");
    onClose();
  };

  return (
    <Modal
      open={Boolean(orderId)}
      onOpenChange={(open) => !open && close()}
      title="تفاصيل الطلب"
      description={orderId ? `#${orderId.slice(0, 8)}` : ""}
      size="xl"
    >
      {detailQuery.isLoading ? <LoadingState /> : null}
      {detailQuery.isError ? (
        <ErrorState
          description={toAppError(detailQuery.error).message}
          onRetry={() => detailQuery.refetch()}
        />
      ) : null}

      {order ? (
        <div className="space-y-6">
          {/* Header — status, type, totals ------------------------ */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">الحالة الحالية</span>
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={order.status as OrderStatus} size="lg" />
                <Badge variant="outline">
                  {order.order_type === "pickup" ? "استلام من المطعم" : "توصيل"}
                </Badge>
                {order.delivery_by_owner ? <SelfDeliveryBadge /> : null}
              </div>
            </div>
            <div className="text-end">
              <span className="text-xs text-muted-foreground">الإجمالي</span>
              <p className="text-xl font-extrabold tabular-nums">
                {EGP(order.money.total_amount)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(order.created_at, locale)}
              </p>
            </div>
          </div>

          {order.rejection_reason ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-400">
              <span className="font-bold">سبب الرفض: </span>
              {order.rejection_reason}
            </div>
          ) : null}

          <MilestoneTrack order={order} />

          {/* Parties --------------------------------------------- */}
          <Section title="الأطراف" icon={User}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="العميل"
                value={
                  <>
                    <p>{order.customer.full_name ?? "—"}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
                      {order.contact_phone ?? order.customer.phone ?? "—"}
                    </p>
                    {order.alternate_phone ? (
                      <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                        بديل: {order.alternate_phone}
                      </p>
                    ) : null}
                  </>
                }
              />
              <Field
                label="المطعم"
                value={
                  <>
                    <p>{locale === "ar" ? order.restaurant.name_ar : order.restaurant.name_en}</p>
                    {order.branch ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        فرع: {locale === "ar" ? order.branch.name_ar : order.branch.name_en}
                        {order.branch.phones.length > 0 ? (
                          <span className="font-mono" dir="ltr">
                            {" · "}
                            {order.branch.phones[0]}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </>
                }
              />
              <Field
                label="المندوب"
                value={
                  order.driver ? (
                    <>
                      <p className="flex items-center gap-1.5">
                        <Bike className="h-3.5 w-3.5" />
                        {order.driver.full_name ?? "—"}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
                        {order.driver.phone ?? "—"}
                      </p>
                    </>
                  ) : order.delivery_by_owner ? (
                    <span className="text-muted-foreground">المطعم يوصّل بنفسه</span>
                  ) : order.order_type === "pickup" ? (
                    <span className="text-muted-foreground">استلام من المطعم</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      لم يستلمه مندوب بعد
                    </span>
                  )
                }
              />
              <Field
                label="عنوان التسليم"
                value={
                  <>
                    <p>{order.delivery_address || "—"}</p>
                    {order.delivery_distance_km != null ? (
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {Number(order.delivery_distance_km).toFixed(2)} كم من الفرع
                      </p>
                    ) : null}
                  </>
                }
              />
            </div>
          </Section>

          {/* Items ----------------------------------------------- */}
          <Section
            title="الأصناف"
            icon={Package}
            action={
              <Badge variant="secondary">
                {order.items.reduce((sum, it) => sum + it.quantity, 0)} قطعة
              </Badge>
            }
          >
            {order.items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                لا توجد أصناف مسجلة على هذا الطلب
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs">
                      <th className="px-3 py-2 text-start font-bold">الصنف</th>
                      <th className="px-3 py-2 text-center font-bold">الكمية</th>
                      <th className="px-3 py-2 text-end font-bold">السعر</th>
                      <th className="px-3 py-2 text-end font-bold">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          {(locale === "ar" ? item.item_name_ar : item.item_name_en) ??
                            item.item_name_ar ??
                            "—"}
                          {item.special_instructions ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {item.special_instructions}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums">×{item.quantity}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{EGP(item.price)}</td>
                        <td className="px-3 py-2 text-end font-semibold tabular-nums">
                          {EGP(item.line_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {order.notes ? (
              <p className="mt-2 rounded-lg border border-border bg-muted/30 p-2.5 text-sm">
                <span className="text-xs text-muted-foreground">ملاحظات العميل: </span>
                {order.notes}
              </p>
            ) : null}
          </Section>

          {/* Money ----------------------------------------------- */}
          <Section title="الفاتورة والتحصيل" icon={Receipt}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <MoneyRow label="مجموع الأصناف" value={EGP(order.money.subtotal)} />
                <MoneyRow label="رسوم التوصيل" value={EGP(order.money.delivery_fee)} />
                {Number(order.money.discount ?? 0) > 0 ? (
                  <MoneyRow
                    label={
                      order.voucher ? `خصم (${order.voucher.code})` : "خصم"
                    }
                    value={`− ${EGP(order.money.discount)}`}
                    tone="negative"
                  />
                ) : null}
                <MoneyRow label="الإجمالي" value={EGP(order.money.total_amount)} bold />
              </div>

              <div className="rounded-lg border border-border p-3">
                <MoneyRow
                  label={`العمولة (${order.money.commission_percentage ?? 0}%)`}
                  value={EGP(order.money.commission_amount)}
                  tone="positive"
                />
                {/* Voucher split from migration 053: the platform's
                    commission absorbs the discount first, and the
                    restaurant only eats whatever overflows. */}
                {Number(order.money.discount_platform_share ?? 0) > 0 ? (
                  <MoneyRow
                    label="من الخصم — على المنصة"
                    value={EGP(order.money.discount_platform_share)}
                    tone="muted"
                  />
                ) : null}
                {Number(order.money.discount_restaurant_share ?? 0) > 0 ? (
                  <MoneyRow
                    label="من الخصم — على المطعم"
                    value={EGP(order.money.discount_restaurant_share)}
                    tone="muted"
                  />
                ) : null}
                <MoneyRow
                  label="صافي المطعم"
                  value={EGP(order.money.restaurant_revenue)}
                />
                <MoneyRow
                  label="أرباح المندوب"
                  value={EGP(order.money.driver_earnings)}
                  bold
                />
              </div>
            </div>
          </Section>

          {/* Route ----------------------------------------------- */}
          {order.order_type === "delivery" ? (
            <Section title="المسار" icon={MapPin}>
              <OrderRouteMap
                branch={
                  order.branch_lat != null && order.branch_lng != null
                    ? { lat: order.branch_lat, lng: order.branch_lng }
                    : null
                }
                delivery={
                  order.delivery_lat != null && order.delivery_lng != null
                    ? { lat: order.delivery_lat, lng: order.delivery_lng }
                    : null
                }
                distanceKm={order.delivery_distance_km}
              />
            </Section>
          ) : null}

          {/* Rating ---------------------------------------------- */}
          {order.rating ? (
            <Section title="تقييم العميل" icon={Star}>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        "h-4 w-4",
                        i < order.rating!.stars
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/30",
                      )}
                    />
                  ))}
                  <span className="ms-2 text-xs text-muted-foreground">
                    {formatDate(order.rating.rated_at, locale)}
                  </span>
                </div>
                {order.rating.review ? (
                  <p className="mt-2 text-sm">{order.rating.review}</p>
                ) : null}
              </div>
            </Section>
          ) : null}

          {/* Status journal -------------------------------------- */}
          <Section title="سجل تغييرات الحالة" icon={ClipboardList}>
            <div className="space-y-1.5">
              {order.timeline.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-xs"
                >
                  <OrderStatusBadge status={entry.status as OrderStatus} />
                  <span className="text-muted-foreground">
                    {formatDate(entry.created_at, locale)}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.changed_by?.full_name
                      ? `بواسطة ${entry.changed_by.full_name}`
                      : "النظام"}
                  </span>
                  {entry.notes ? (
                    <span className="w-full text-foreground">{entry.notes}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>

          {/* Status change --------------------------------------- */}
          <Section title="تغيير الحالة" icon={Store}>
            {transitions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
                هذه حالة نهائية — لا يمكن نقل الطلب منها.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {transitions.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={pendingStatus === s ? "default" : "outline"}
                      disabled={statusMutation.isPending}
                      onClick={() => setPendingStatus(pendingStatus === s ? null : s)}
                    >
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_STYLE[s].dot)}
                      />
                      {STATUS_LABELS[s]}
                    </Button>
                  ))}
                </div>

                {pendingStatus ? (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder={
                        pendingStatus === "rejected"
                          ? "سبب الرفض (يُحفَظ على الطلب)…"
                          : "ملاحظة تُسجَّل في سجل الحالة (اختياري)…"
                      }
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingStatus(null)}
                        disabled={statusMutation.isPending}
                      >
                        إلغاء
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => statusMutation.mutate(pendingStatus)}
                        disabled={statusMutation.isPending}
                      >
                        تأكيد النقل إلى «{STATUS_LABELS[pendingStatus]}»
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Section>

          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3 w-3" />
            رقم الطلب الكامل: <span className="font-mono">{order.id}</span>
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
