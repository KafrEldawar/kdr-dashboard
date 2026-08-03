"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PauseCircle } from "lucide-react";
import { orderingStatusService } from "@/services/settings";
import { ORDERING_STATUS_QUERY_KEY } from "@/modules/settings/ordering-switch-card";

/// Sits under the header on every page while online ordering is paused.
///
/// A platform-wide stop is easy to switch on during an incident and very easy
/// to forget once the incident is over — a quiet flag in a settings page
/// costs a day of orders. This makes forgetting it impossible.
export function OrderingPausedBanner() {
  const { data } = useQuery({
    queryKey: ORDERING_STATUS_QUERY_KEY,
    queryFn: () => orderingStatusService.get(),
    // Cheap single-row RPC; refetching keeps two open tabs from disagreeing
    // about whether the platform is live.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (!data || data.online_ordering_enabled) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:px-6 lg:px-8">
      <span className="flex items-center gap-2 font-semibold">
        <PauseCircle className="h-4 w-4 shrink-0" />
        الطلب الأونلاين متوقف حالياً لكل المطاعم
        {data.paused_reason_ar ? (
          <span className="font-normal opacity-80">— {data.paused_reason_ar}</span>
        ) : null}
      </span>
      <Link href="/settings" className="font-semibold underline underline-offset-4">
        تشغيله تاني
      </Link>
    </div>
  );
}
