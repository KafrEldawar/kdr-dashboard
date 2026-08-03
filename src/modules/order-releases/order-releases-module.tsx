"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Building2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";
import { orderReleasesService, type OrderRelease } from "@/services/delivery";

/// Orders a rider claimed and then handed back.
///
/// One release is noise — a bike breaks down. The number that matters is
/// the per-rider tally, so it leads the page; the log below is the
/// evidence behind it.
export function OrderReleasesModule() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = useQuery({
    queryKey: ["order-releases", from, to],
    queryFn: () =>
      orderReleasesService.list({
        from: from || undefined,
        to: to || undefined,
      }),
  });

  const columns = useMemo<ColumnDef<OrderRelease>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "التاريخ",
        cell: ({ row }) =>
          new Date(row.original.created_at).toLocaleString("ar-EG", {
            dateStyle: "short",
            timeStyle: "short",
          }),
      },
      {
        accessorKey: "driver_name",
        header: "المندوب",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-medium">
                {r.office_name || r.driver_name || "—"}
              </span>
              <span className="text-xs text-muted-foreground">
                {r.driver_phone ?? ""}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "provider_kind",
        header: "النوع",
        cell: ({ row }) =>
          row.original.provider_kind === "office" ? (
            <Badge variant="solid">
              <Building2 className="h-3 w-3" />
              مكتب
            </Badge>
          ) : (
            <Badge variant="outline">
              <User className="h-3 w-3" />
              فردي
            </Badge>
          ),
      },
      {
        accessorKey: "reason",
        header: "السبب",
        cell: ({ row }) => (
          <span className="max-w-[260px] block truncate">
            {row.original.reason || "—"}
          </span>
        ),
      },
      {
        accessorKey: "restaurant_name",
        header: "المطعم",
        cell: ({ row }) => row.original.restaurant_name ?? "—",
      },
      {
        accessorKey: "order_status",
        header: "حالة الطلب دلوقتي",
        cell: ({ row }) => {
          const s = row.original.order_status;
          if (!s) return "—";
          // After a release the order goes back to the pool, so it is
          // usually still open. A delivered one means someone else picked
          // it up — worth seeing at a glance.
          return s === "delivered" ? (
            <Badge variant="success">اتسلّم بعدها</Badge>
          ) : s === "cancelled" ? (
            <Badge variant="destructive">اتلغى</Badge>
          ) : (
            <Badge variant="warning">{s}</Badge>
          );
        },
      },
    ],
    []
  );

  const byDriver = query.data?.by_driver ?? [];
  const repeat = byDriver.filter((d) => d.releases >= 3);

  return (
    <>
      <PageHeader
        title="الطلبات المتروكة"
        description="الطلبات اللي مندوب استلمها وبعدين رجّعها للقائمة، والسبب اللي كتبه. التطبيق بيطلب السبب إجبارياً قبل الترك."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="from">من</Label>
          <Input
            id="from"
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="to">إلى</Label>
          <Input
            id="to"
            type="date"
            className="w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          description={toAppError(query.error).message}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.data ? (
        <>
          {byDriver.length > 0 ? (
            <Card className="mb-4 p-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span className="font-semibold">عدد مرات الترك لكل مندوب</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {byDriver.map((d) => (
                  <Badge
                    key={d.driver_id}
                    variant={d.releases >= 3 ? "destructive" : "secondary"}
                  >
                    {d.driver_name || "—"}: {d.releases}
                  </Badge>
                ))}
              </div>
              {repeat.length > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {repeat.length} مندوب ترك ٣ طلبات أو أكتر في الفترة دي — يستاهل
                  مراجعة.
                </p>
              ) : null}
            </Card>
          ) : null}

          <DataTable
            columns={columns}
            data={query.data.data}
            emptyTitle="مفيش طلبات متروكة في الفترة دي"
          />
        </>
      ) : null}
    </>
  );
}
