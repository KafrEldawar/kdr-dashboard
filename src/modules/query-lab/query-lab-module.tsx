"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";
import { adminService } from "@/services/admin";
import { requireSupabase } from "@/lib/supabase/client";

type NamedQuery = {
  id: string;
  label: string;
  description: string;
  run: () => Promise<unknown[]>;
};

function makeQueries(): NamedQuery[] {
  const supabase = requireSupabase();
  return [
    {
      id: "top-restaurants",
      label: "أكثر المطاعم طلبات",
      description: "المطاعم مرتبة حسب عدد الطلبات",
      run: async () => {
        const { data, error } = await supabase
          .from("orders")
          .select("restaurant_id, count:id.count()")
          .limit(10);
        if (error) throw error;
        return data ?? [];
      },
    },
    {
      id: "recent-orders",
      label: "آخر 20 طلب",
      description: "الطلبات الأحدث مع الحالة والإجمالي",
      run: async () => {
        const { data, error } = await supabase
          .from("orders")
          .select("id, status, total_amount, created_at")
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;
        return data ?? [];
      },
    },
    {
      id: "users-by-role",
      label: "المستخدمون حسب الدور",
      description: "إجمالي المستخدمين لكل دور",
      run: async () => {
        const { data, error } = await supabase
          .from("profiles")
          .select("role, count:id.count()");
        if (error) throw error;
        return data ?? [];
      },
    },
    {
      id: "active-vouchers",
      label: "أكواد الخصم النشطة",
      description: "الأكواد النشطة مع عدد الاستخدام",
      run: async () => {
        const { data, error } = await supabase
          .from("vouchers")
          .select("code, discount_type, discount_value, used_count, usage_limit, valid_to")
          .eq("is_active", true)
          .order("used_count", { ascending: false })
          .limit(20);
        if (error) throw error;
        return data ?? [];
      },
    },
    {
      id: "revenue-by-status",
      label: "الإيرادات حسب الحالة",
      description: "مجموع total_amount لكل حالة طلب",
      run: async () => {
        const { data, error } = await supabase
          .from("orders")
          .select("status, sum:total_amount.sum()");
        if (error) throw error;
        return data ?? [];
      },
    },
    {
      id: "menu-items-count",
      label: "عناصر المنيو لكل مطعم",
      description: "عدد عناصر المنيو مرتبة تنازلياً",
      run: async () => {
        const { data, error } = await supabase
          .from("menu_items")
          .select("restaurant_id, count:id.count()")
          .limit(20);
        if (error) throw error;
        return data ?? [];
      },
    },
    {
      id: "audit-summary",
      label: "ملخص سجل الأنشطة",
      description: "آخر 20 نشاط في النظام",
      run: async () => {
        const result = await adminService.listAuditLogs({ pageSize: 20 });
        return result.data;
      },
    },
    {
      id: "top-rated",
      label: "أعلى تقييمات",
      description: "المطاعم الأعلى تقييماً (متوسط من الطلبات)",
      run: async () => {
        const { data, error } = await supabase
          .from("orders")
          .select("restaurant_id, avg:restaurant_rating.avg()")
          .not("restaurant_rating", "is", null)
          .limit(10);
        if (error) throw error;
        return data ?? [];
      },
    },
  ];
}

export function QueryLabModule() {
  const [activeQuery, setActiveQuery] = useState<NamedQuery | null>(null);
  const queries = makeQueries();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["query-lab", activeQuery?.id],
    queryFn: () => activeQuery!.run(),
    enabled: Boolean(activeQuery),
    retry: false,
  });

  const keys = data && data.length > 0 ? Object.keys(data[0] as object) : [];

  return (
    <>
      <PageHeader
        title="معمل الاستعلامات"
        description="استعلامات جاهزة تُشغَّل مباشرة على قاعدة البيانات."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">الاستعلامات</p>
          {queries.map((q) => (
            <button
              key={q.id}
              onClick={() => setActiveQuery(q)}
              className={`w-full text-start rounded-lg border p-3 text-sm transition hover:bg-muted ${
                activeQuery?.id === q.id ? "border-primary bg-primary/5" : ""
              }`}
            >
              <p className="font-medium">{q.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{q.description}</p>
            </button>
          ))}
        </div>

        <div>
          {!activeQuery ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Database className="h-10 w-10" />
                <p className="text-sm">اختر استعلاماً من القائمة لتشغيله</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4 pb-3">
                <div>
                  <CardTitle className="text-base">{activeQuery.label}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{activeQuery.description}</p>
                </div>
                <Button size="sm" onClick={() => refetch()} disabled={isLoading}>
                  <Play className="h-4 w-4" />
                  تشغيل
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? <LoadingState /> : null}
                {isError ? (
                  <ErrorState description={toAppError(error).message} onRetry={() => refetch()} />
                ) : null}
                {data && data.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">لا يوجد نتائج</p>
                ) : null}
                {data && data.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          {keys.map((k) => (
                            <th key={k} className="py-2 px-3 text-start font-semibold text-muted-foreground">
                              {k}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.map((row, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                            {keys.map((k) => {
                              const val = (row as Record<string, unknown>)[k];
                              return (
                                <td key={k} className="py-2 px-3 font-mono">
                                  {val === null || val === undefined ? (
                                    <span className="text-muted-foreground">null</span>
                                  ) : typeof val === "object" ? (
                                    <Badge variant="outline" className="text-xs">
                                      {JSON.stringify(val).slice(0, 40)}
                                    </Badge>
                                  ) : (
                                    String(val)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-3 text-xs text-muted-foreground">{data.length} نتيجة</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
