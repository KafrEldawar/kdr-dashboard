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

/**
 * Query keys must match the whitelist in `rpc_admin_run_named_query`
 * (migration 064). Every query used to run in the browser through
 * PostgREST's aggregate syntax (`count:id.count()`), but aggregates
 * are disabled on this project, so five of the eight always failed
 * with PGRST123. They now live in SQL inside the RPC — which also
 * lets them join across tables instead of returning bare UUIDs.
 */
type NamedQuery = {
  key: string;
  label: string;
  description: string;
};

const QUERIES: NamedQuery[] = [
  {
    key: "top_restaurants",
    label: "أكثر المطاعم طلبات",
    description: "الطلبات والإيراد ومتوسط الطلب لكل مطعم",
  },
  {
    key: "orders_by_day",
    label: "الطلبات يوماً بيوم",
    description: "آخر ٣٠ يوم — العدد والمُسلَّم والإيراد",
  },
  {
    key: "recent_orders",
    label: "آخر ٢٠ طلب",
    description: "الأحدث مع اسم المطعم والعميل والحالة",
  },
  {
    key: "revenue_by_status",
    label: "الإيرادات حسب الحالة",
    description: "الإجمالي والعمولة ورسوم التوصيل لكل حالة",
  },
  {
    key: "delivery_performance",
    label: "أداء التوصيل",
    description: "متوسط دقائق كل مرحلة لكل مطعم",
  },
  {
    key: "users_by_role",
    label: "المستخدمون حسب الدور",
    description: "العدد والنشط والمُوثَّق لكل دور",
  },
  {
    key: "top_customers",
    label: "أكثر العملاء طلباً",
    description: "أعلى ٢٠ عميل بعدد الطلبات وإجمالي الإنفاق",
  },
  {
    key: "top_rated",
    label: "أعلى تقييمات",
    description: "متوسط تقييم كل مطعم وعدد التقييمات",
  },
  {
    key: "menu_items_per_restaurant",
    label: "عناصر المنيو لكل مطعم",
    description: "العدد الكلي والمتاح منه",
  },
  {
    key: "active_vouchers",
    label: "أكواد الخصم النشطة",
    description: "الأكواد النشطة مع عدد الاستخدام وحالة الصلاحية",
  },
  {
    key: "audit_summary",
    label: "ملخص سجل الأنشطة",
    description: "آخر ٣٠ نشاط في النظام",
  },
];

/** Arabic headers for the columns the RPC returns. */
const COLUMN_LABELS: Record<string, string> = {
  restaurant: "المطعم",
  customer: "العميل",
  orders: "الطلبات",
  delivered: "مُسلَّم",
  cancelled: "ملغي/مرفوض",
  revenue: "الإيراد",
  avg_order: "متوسط الطلب",
  order_id: "رقم الطلب",
  status: "الحالة",
  total: "الإجمالي",
  spent: "إجمالي الإنفاق",
  commission: "العمولة",
  delivery_fees: "رسوم التوصيل",
  created_at: "التاريخ",
  last_order: "آخر طلب",
  day: "اليوم",
  role: "الدور",
  active: "نشط",
  phone: "الموبايل",
  phone_verified: "موثَّق الرقم",
  whatsapp_opt_in: "واتساب",
  new_30d: "جديد (٣٠ يوم)",
  items: "العناصر",
  available: "متاح",
  code: "الكود",
  discount_type: "نوع الخصم",
  discount_value: "قيمة الخصم",
  used_count: "مرات الاستخدام",
  usage_limit: "الحد الأقصى",
  valid_to: "ينتهي في",
  expired: "منتهي",
  avg_rating: "متوسط التقييم",
  ratings: "عدد التقييمات",
  five_star: "٥ نجوم",
  avg_accept_min: "دقائق القبول",
  avg_claim_min: "دقائق الاستلام",
  avg_pickup_min: "دقائق الخروج",
  avg_deliver_min: "دقائق التسليم",
  avg_total_min: "الإجمالي (دقيقة)",
  action: "الإجراء",
  table: "الجدول",
  record_id: "المعرّف",
  user: "المستخدم",
};

export function QueryLabModule() {
  const [activeQuery, setActiveQuery] = useState<NamedQuery | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["query-lab", activeQuery?.key],
    queryFn: () => adminService.runNamedQuery(activeQuery!.key),
    enabled: Boolean(activeQuery),
    retry: false,
  });

  const keys = data && data.length > 0 ? Object.keys(data[0]) : [];

  return (
    <>
      <PageHeader
        title="معمل الاستعلامات"
        description="تقارير جاهزة تُنفَّذ داخل قاعدة البيانات مباشرة."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">الاستعلامات</p>
          {QUERIES.map((q) => (
            <button
              key={q.key}
              onClick={() => setActiveQuery(q)}
              className={`w-full text-start rounded-lg border p-3 text-sm transition hover:bg-muted ${
                activeQuery?.key === q.key ? "border-primary bg-primary/5" : ""
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
                  <>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-primary/15 bg-accent">
                            {keys.map((k) => (
                              <th
                                key={k}
                                className="py-2.5 px-3 text-start font-bold text-accent-foreground whitespace-nowrap"
                              >
                                {COLUMN_LABELS[k] ?? k}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.map((row, i) => (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                              {keys.map((k) => (
                                <td key={k} className="py-2 px-3">
                                  <Cell value={row[k]} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">{data.length} نتيجة</p>
                  </>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "boolean") {
    return (
      <Badge variant={value ? "default" : "secondary"} className="text-xs">
        {value ? "نعم" : "لا"}
      </Badge>
    );
  }
  if (typeof value === "object") {
    return (
      <Badge variant="outline" className="text-xs">
        {JSON.stringify(value).slice(0, 40)}
      </Badge>
    );
  }
  if (typeof value === "number") {
    return <span className="font-mono tabular-nums">{value.toLocaleString("en-US")}</span>;
  }
  return <span className="font-mono">{String(value)}</span>;
}
