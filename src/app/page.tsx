"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, ClipboardList, Store, Users, ShoppingCart, Star, Tag, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/error-state";
import { analyticsService } from "@/services/analytics";
import { toAppError } from "@/lib/errors";

export default function DashboardPage() {
  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => analyticsService.getDashboardStats(),
    retry: false,
  });

  const stats = statsQuery.data;
  const isError = statsQuery.isError;

  return (
    <AppShell>
      <PageHeader
        title="لوحة التحكم"
        description="نظرة عامة على النظام — البيانات مباشرة من Supabase."
      />

      {isError ? (
        <div className="mb-4">
          <ErrorState
            description={`${toAppError(statsQuery.error).message} — تأكد أنك مسجل دخول كأدمن وأن الـ JWT Hook مُفعّل.`}
            onRetry={() => statsQuery.refetch()}
          />
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="المستخدمين"
          value={stats ? String(stats.users) : "—"}
          icon={Users}
          note="العملاء المسجلين"
        />
        <StatCard
          label="المطاعم"
          value={stats ? String(stats.restaurants) : "—"}
          icon={Store}
          note="المطاعم النشطة"
        />
        <StatCard
          label="الطلبات اليوم"
          value={stats ? String(stats.orders_today) : "—"}
          icon={ClipboardList}
          note={`إجمالي: ${stats?.orders_total ?? "—"}`}
        />
        <StatCard
          label="الطلبات قيد التنفيذ"
          value={stats ? String(stats.orders_pending) : "—"}
          icon={Activity}
          note="pending"
        />
        <StatCard
          label="إيرادات اليوم"
          value={stats ? `${stats.revenue_today} ج.م` : "—"}
          icon={TrendingUp}
          note="بدون الملغي"
        />
        <StatCard
          label="التصنيفات"
          value={stats ? String(stats.categories) : "—"}
          icon={Tag}
          note="نشطة"
        />
        <StatCard
          label="العروض"
          value={stats ? String(stats.offers) : "—"}
          icon={ShoppingCart}
          note="عروض فعّالة"
        />
        <StatCard
          label="التقييمات"
          value={stats ? String(stats.ratings_total) : "—"}
          icon={Star}
          note="من عملاء حقيقيين"
        />
      </section>

      {!isError && !stats ? (
        <section className="mt-6 rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          <p>جاري تحميل الإحصائيات من Supabase…</p>
          <p className="mt-1 text-xs">إذا استمر التحميل، تأكد أنك مسجل دخول كأدمن أو شغّل الـ JWT Hook أولاً.</p>
        </section>
      ) : null}
    </AppShell>
  );
}
