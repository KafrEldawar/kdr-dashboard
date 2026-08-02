"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Info,
  MousePointerClick,
  Smartphone,
  UserCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { toAppError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { analyticsService, type ProductAnalytics } from "@/services/analytics";

const RANGES = [
  { value: "7", label: "آخر ٧ أيام" },
  { value: "30", label: "آخر ٣٠ يوم" },
  { value: "90", label: "آخر ٩٠ يوم" },
];

/** Arabic label per tracked event. Anything unmapped renders raw. */
const EVENT_LABELS: Record<string, string> = {
  app_open: "فتح التطبيق",
  screen_view: "عرض شاشة",
  search_performed: "بحث",
  category_selected: "اختيار تصنيف",
  restaurant_viewed: "فتح مطعم",
  menu_item_viewed: "فتح صنف",
  offer_viewed: "فتح عرض",
  favorite_added: "إضافة للمفضلة",
  favorite_removed: "إزالة من المفضلة",
  add_to_cart: "إضافة للسلة",
  remove_from_cart: "حذف من السلة",
  cart_viewed: "فتح السلة",
  checkout_started: "بدء إتمام الطلب",
  voucher_applied: "تطبيق كود خصم",
  voucher_rejected: "كود خصم مرفوض",
  order_placed: "إتمام طلب",
  order_place_failed: "فشل إتمام طلب",
  order_tracked: "متابعة طلب",
  order_cancelled: "إلغاء طلب",
  order_rated: "تقييم طلب",
  login_started: "بدء تسجيل دخول",
  login_completed: "تسجيل دخول ناجح",
  login_failed: "فشل تسجيل دخول",
  signed_out: "تسجيل خروج",
  address_added: "إضافة عنوان",
  profile_updated: "تعديل الملف",
  notification_opened: "فتح إشعار",
};

const PLATFORM_LABELS: Record<string, string> = {
  android: "أندرويد",
  ios: "آيفون",
  unknown: "غير معروف",
};

export function ProductAnalyticsModule() {
  const [days, setDays] = useState("30");

  const query = useQuery({
    queryKey: ["product-analytics", days],
    queryFn: () => analyticsService.getProductAnalytics(Number(days)),
    retry: false,
  });

  const data = query.data;
  const noData = data != null && data.totals.events === 0;

  return (
    <>
      <PageHeader
        icon={Activity}
        title="تحليلات المنتج"
        description="سلوك المستخدمين داخل التطبيق — أكثر الفيتشرز استخداماً ومسار الطلب."
      />

      <div className="mb-4 flex justify-end">
        <div className="w-48">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState
          description={toAppError(query.error).message}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {/* Empty state is the expected view right after launch: events only
          exist from the moment an instrumented build reaches real phones,
          and there is nothing to backfill. Saying so beats an ambiguous
          screen of zeros that looks like a bug. */}
      {noData ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Info className="h-10 w-10 text-muted-foreground" />
            <p className="text-base font-semibold">لسه مفيش أحداث مسجلة</p>
            <p className="max-w-md text-sm text-muted-foreground">
              التتبع بيبدأ من أول ما إصدار جديد من التطبيق يوصل للمستخدمين.
              مفيش بيانات قديمة ممكن تترجّع — الأرقام هتبدأ تظهر هنا خلال ساعات
              من نزول الإصدار على المتجر.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {data && !noData ? (
        <>
          <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="مستخدمين معروفين"
              value={String(data.totals.known_users)}
              icon={UserCheck}
              note="حسابات مسجلة نشطة"
            />
            <StatCard
              label="الجلسات"
              value={String(data.totals.sessions)}
              icon={Users}
              accent="blue"
              note={`${data.totals.guest_sessions} منها بدون تسجيل دخول`}
            />
            <StatCard
              label="إجمالي الأحداث"
              value={data.totals.events.toLocaleString("en-US")}
              icon={MousePointerClick}
              accent="violet"
              note={`${data.totals.events_today} اليوم`}
            />
            <StatCard
              label="متوسط الأحداث للجلسة"
              value={
                data.totals.sessions > 0
                  ? (data.totals.events / data.totals.sessions).toFixed(1)
                  : "0"
              }
              icon={Activity}
              accent="green"
              note="كل ما زاد، كل ما التفاعل أعمق"
            />
          </section>

          <FunnelCard funnel={data.funnel} />

          <div className="mb-8 grid gap-4 lg:grid-cols-2">
            <LeaderboardCard
              title="أكثر الفيتشرز استخداماً"
              rows={data.top_events.map((e) => ({
                label: EVENT_LABELS[e.event] ?? e.event,
                sub: e.event,
                primary: e.count,
                secondary: e.users,
              }))}
              primaryLabel="مرة"
              secondaryLabel="مستخدم"
            />
            <LeaderboardCard
              title="أكثر الشاشات فتحاً"
              rows={data.top_screens.map((s) => ({
                label: s.screen,
                primary: s.views,
                secondary: s.users,
              }))}
              primaryLabel="فتحة"
              secondaryLabel="مستخدم"
              emptyHint="محتاج أحداث screen_view — ضيفها للشاشات اللي عايز تتابعها."
            />
          </div>

          <DailyCard daily={data.daily} />

          <div className="grid gap-4 lg:grid-cols-2">
            <SplitCard
              title="المنصات"
              icon={Smartphone}
              rows={data.platforms.map((p) => ({
                label: PLATFORM_LABELS[p.platform] ?? p.platform,
                value: p.sessions,
              }))}
              unit="جلسة"
            />
            <SplitCard
              title="إصدارات التطبيق"
              icon={Info}
              rows={data.versions.map((v) => ({
                label: v.app_version,
                value: v.sessions,
              }))}
              unit="جلسة"
            />
          </div>
        </>
      ) : null}
    </>
  );
}

/**
 * Browse → order, in distinct people rather than raw taps. Each step
 * shows conversion from the previous one, because "40% drop at add to
 * cart" is the actionable number — not the absolute count.
 */
function FunnelCard({ funnel }: { funnel: ProductAnalytics["funnel"] }) {
  const steps = [
    { key: "restaurant_viewed", label: "فتح مطعم", value: funnel.restaurant_viewed },
    { key: "add_to_cart", label: "أضاف للسلة", value: funnel.add_to_cart },
    { key: "checkout_started", label: "بدأ إتمام الطلب", value: funnel.checkout_started },
    { key: "order_placed", label: "أتمّ الطلب", value: funnel.order_placed },
  ];
  const top = Math.max(1, steps[0].value);

  return (
    <Card className="mb-8">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">مسار التحويل</CardTitle>
        <p className="text-xs text-muted-foreground">
          عدد الأشخاص اللي وصلوا لكل خطوة — مش عدد الضغطات.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step, i) => {
          const prev = i === 0 ? null : steps[i - 1].value;
          const rate = prev && prev > 0 ? Math.round((step.value / prev) * 100) : null;
          return (
            <div key={step.key}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{step.label}</span>
                <span className="flex items-center gap-2">
                  {rate != null ? (
                    <Badge
                      variant={rate >= 50 ? "success" : rate >= 25 ? "warning" : "destructive"}
                    >
                      {rate}% من السابق
                    </Badge>
                  ) : null}
                  <span className="tabular-nums font-bold">{step.value}</span>
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(2, (step.value / top) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
        {steps[0].value > 0 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            التحويل الكلي من فتح المطعم لإتمام الطلب:{" "}
            <span className="font-bold text-foreground">
              {Math.round((steps[3].value / steps[0].value) * 100)}%
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LeaderboardCard({
  title,
  rows,
  primaryLabel,
  secondaryLabel,
  emptyHint,
}: {
  title: string;
  rows: { label: string; sub?: string; primary: number; secondary: number }[];
  primaryLabel: string;
  secondaryLabel: string;
  emptyHint?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.primary));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyHint ?? "لا يوجد بيانات"}
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => (
              <div key={row.sub ?? row.label}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{row.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {row.primary.toLocaleString("en-US")} {primaryLabel} ·{" "}
                    {row.secondary.toLocaleString("en-US")} {secondaryLabel}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${(row.primary / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyCard({ daily }: { daily: ProductAnalytics["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.sessions));

  return (
    <Card className="mb-8">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">النشاط اليومي</CardTitle>
        <p className="text-xs text-muted-foreground">
          الجلسات لكل يوم — الأيام الفاضية بتظهر كأصفار عشان الفجوات تبان.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-1 overflow-x-auto pb-1" dir="ltr">
          {daily.map((d) => (
            <div
              key={d.day}
              className="group relative flex min-w-[8px] flex-1 flex-col justify-end"
              title={`${d.day} — ${d.sessions} جلسة، ${d.users} مستخدم، ${d.events} حدث`}
            >
              <div
                className={cn(
                  "w-full rounded-t transition-colors",
                  d.sessions > 0 ? "bg-primary/70 hover:bg-primary" : "bg-muted",
                )}
                style={{ height: `${Math.max(2, (d.sessions / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground" dir="ltr">
          <span>{daily[0]?.day}</span>
          <span>{daily[daily.length - 1]?.day}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SplitCard({
  title,
  icon: Icon,
  rows,
  unit,
}: {
  title: string;
  icon: React.ElementType;
  rows: { label: string; value: number }[];
  unit: string;
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لا يوجد بيانات</p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{row.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="tabular-nums">
                    {total > 0 ? Math.round((row.value / total) * 100) : 0}%
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {row.value} {unit}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
