"use client";

import { Bike } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/types/database";

export const ALL_STATUSES: OrderStatus[] = [
  "pending",
  "preparing",
  "ready_for_pickup",
  "out_for_delivery",
  "delivered",
  "picked_up_by_customer",
  "rejected",
  "cancelled",
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "قيد الانتظار",
  preparing: "قيد التحضير",
  ready_for_pickup: "جاهز للاستلام",
  out_for_delivery: "في الطريق",
  delivered: "تم التسليم",
  picked_up_by_customer: "استلمه العميل",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

// Semantic per-status styling (pill background/text + status dot).
export const STATUS_STYLE: Record<OrderStatus, { pill: string; dot: string }> = {
  pending: {
    pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25",
    dot: "bg-amber-500",
  },
  preparing: {
    pill: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/25",
    dot: "bg-blue-500",
  },
  ready_for_pickup: {
    pill: "bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/25",
    dot: "bg-teal-500",
  },
  out_for_delivery: {
    pill: "bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/25",
    dot: "bg-violet-500",
  },
  delivered: {
    pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
    dot: "bg-emerald-500",
  },
  picked_up_by_customer: {
    pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
    dot: "bg-emerald-500",
  },
  rejected: {
    pill: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25",
    dot: "bg-red-500",
  },
  cancelled: {
    pill: "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-500/15 dark:text-zinc-400 dark:ring-zinc-500/25",
    dot: "bg-zinc-400",
  },
};

/**
 * Mirror of the transition table in `rpc_admin_update_order_status`
 * (migration 064). Kept client-side only so the UI can grey out
 * moves the server would reject anyway — the RPC is the authority,
 * and it re-checks every transition regardless of what we send.
 */
export function allowedTransitions(
  current: OrderStatus,
  orderType: "delivery" | "pickup",
): OrderStatus[] {
  switch (current) {
    case "pending":
      return ["preparing", "rejected", "cancelled"];
    case "preparing":
      return orderType === "pickup"
        ? ["ready_for_pickup", "cancelled"]
        : ["ready_for_pickup", "out_for_delivery", "cancelled"];
    case "ready_for_pickup":
      return orderType === "pickup"
        ? ["picked_up_by_customer", "cancelled"]
        : ["out_for_delivery", "cancelled"];
    case "out_for_delivery":
      return ["delivered", "cancelled"];
    default:
      // delivered / picked_up_by_customer / rejected / cancelled are terminal.
      return [];
  }
}

export function OrderStatusBadge({
  status,
  size = "sm",
}: {
  status: OrderStatus;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        size === "lg" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs",
        STATUS_STYLE[status].pill,
      )}
    >
      <span
        className={cn(
          "rounded-full",
          size === "lg" ? "h-2 w-2" : "h-1.5 w-1.5",
          STATUS_STYLE[status].dot,
        )}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Marks an order delivered by the restaurant owner instead of a
 * platform driver. Renders as a small chip next to the status pill so
 * support can spot self-delivery without opening the detail modal.
 */
export function SelfDeliveryBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/25"
      title="توصيل من المطعم"
    >
      <Bike className="h-3 w-3" />
      توصيل ذاتي
    </span>
  );
}
