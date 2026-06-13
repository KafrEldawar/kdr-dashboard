"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  BadgePercent,
  ClipboardList,
  Gift,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Star,
  Store,
  Tag,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { analyticsService } from "@/services/analytics";
import { ordersService } from "@/services/orders";
import { offersService } from "@/services/offers";
import { restaurantsService } from "@/services/restaurants";
import { adminService, type AdminUser } from "@/services/admin";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useLocale } from "@/lib/i18n";
import type { Offer, Order, OrderStatus, Restaurant } from "@/types/database";

const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "preparing",
  "ready_for_pickup",
  "out_for_delivery",
];

const statusLabels: Record<OrderStatus, string> = {
  pending: "قيد الانتظار",
  preparing: "قيد التحضير",
  ready_for_pickup: "جاهز للاستلام",
  out_for_delivery: "في الطريق",
  delivered: "تم التسليم",
  picked_up_by_customer: "استلمه العميل",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

const statusVariant: Record<
  OrderStatus,
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
> = {
  pending: "warning",
  preparing: "default",
  ready_for_pickup: "secondary",
  out_for_delivery: "success",
  delivered: "success",
  picked_up_by_customer: "success",
  rejected: "destructive",
  cancelled: "destructive",
};

const roleLabels: Record<string, string> = {
  customer: "عميل",
  restaurant: "مطعم",
  driver: "مندوب",
  admin: "أدمن",
};

const roleVariant: Record<string, "solid" | "secondary" | "outline"> = {
  admin: "solid",
  restaurant: "secondary",
  customer: "outline",
  driver: "outline",
};

const quickActions = [
  { label: "إضافة مطعم", href: "/restaurants/new", icon: Store, add: true },
  { label: "إضافة مستخدم", href: "/users?new=1", icon: UserPlus, add: true },
  { label: "إضافة عرض", href: "/offers?new=1", icon: Gift, add: true },
  { label: "إضافة صنف", href: "/menu-items?new=1", icon: UtensilsCrossed, add: true },
  { label: "الطلبات", href: "/orders", icon: ClipboardList, add: false },
];

function initials(name: string | null) {
  if (!name) return "؟";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

function SectionCard({
  title,
  icon: Icon,
  href,
  children,
}: {
  title: string;
  icon: typeof Activity;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card card-elevated">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="text-base font-bold">{title}</h3>
        </div>
        <Link
          href={href}
          className="flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80"
        >
          عرض الكل
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function PanelEmpty({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

export default function DashboardPage() {
  const locale = useLocale();
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    );
  }, [locale]);

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => analyticsService.getDashboardStats(),
    retry: false,
  });

  const ordersQuery = useQuery({
    queryKey: ["dashboard-active-orders"],
    queryFn: () => ordersService.getAll({ pageSize: 50 }),
    retry: false,
  });

  const offersQuery = useQuery({
    queryKey: ["dashboard-active-offers"],
    queryFn: () => offersService.filters({ is_active: true }, { pageSize: 6 }),
    retry: false,
  });

  const restaurantsQuery = useQuery({
    queryKey: ["dashboard-restaurants"],
    queryFn: () => restaurantsService.getAll({ pageSize: 200 }),
    retry: false,
  });

  const usersQuery = useQuery({
    queryKey: ["dashboard-active-users"],
    queryFn: () => adminService.listUsers({ pageSize: 20 }),
    retry: false,
  });

  const stats = statsQuery.data;
  const isError = statsQuery.isError;

  const restaurantName = (id: string) => {
    const r = (restaurantsQuery.data?.data ?? []).find((x: Restaurant) => x.id === id);
    if (!r) return "—";
    return locale === "ar" ? r.name_ar : r.name_en || r.name_ar;
  };

  const activeOrders: Order[] = (ordersQuery.data?.data ?? [])
    .filter((o: Order) => ACTIVE_STATUSES.includes(o.status))
    .slice(0, 6);

  const activeOffers: Offer[] = offersQuery.data?.data ?? [];

  const activeUsers: AdminUser[] = (usersQuery.data?.data ?? [])
    .filter((u: AdminUser) => u.is_active)
    .slice(0, 6);

  const latestRestaurants: Restaurant[] = (restaurantsQuery.data?.data ?? []).slice(0, 6);

  return (
    <AppShell>
      {/* Branded welcome hero */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-card card-elevated">
        <div
          className="pointer-events-none absolute inset-y-0 end-0 w-1/2 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 100% 0%, hsl(var(--brand)) 0, transparent 55%)",
          }}
        />
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/kdr-logo.svg"
              alt="KDR"
              className="h-14 w-14 shrink-0 rounded-full shadow-sm ring-2 ring-primary/20"
            />
            <div>
              <p className="text-xs font-bold text-primary">مطاعم كفر الدوار · KDR</p>
              <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">أهلاً بك في لوحة التحكم</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {today || "نظرة عامة على النظام"} — البيانات مباشرة من Supabase
              </p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            نظام إدارة داخلي
          </span>
        </div>
      </div>

      {isError ? (
        <div className="mb-4">
          <ErrorState
            description={`${toAppError(statsQuery.error).message} — تأكد أنك مسجل دخول كأدمن وأن الـ JWT Hook مُفعّل.`}
            onRetry={() => statsQuery.refetch()}
          />
        </div>
      ) : null}

      {/* Quick actions */}
      <div className="mb-5 flex flex-wrap gap-2">
        {quickActions.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.href}
              href={a.href}
              className="group inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                {a.add ? <Plus className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </span>
              <Icon className="h-4 w-4" />
              {a.label}
            </Link>
          );
        })}
      </div>

      {/* Stat cards (clickable) */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <StatCard label="المستخدمين" value={stats ? String(stats.users) : "—"} icon={Users} note="العملاء المسجلين" accent="blue" href="/users" />
        <StatCard label="المطاعم" value={stats ? String(stats.restaurants) : "—"} icon={Store} note="المطاعم النشطة" accent="brand" href="/restaurants" />
        <StatCard label="أصحاب المطاعم" value={stats ? String(stats.restaurant_owners) : "—"} icon={UserCog} note="حسابات أصحاب" accent="violet" href="/users" />
        <StatCard label="الطلبات اليوم" value={stats ? String(stats.orders_today) : "—"} icon={ClipboardList} note={`إجمالي: ${stats?.orders_total ?? "—"}`} accent="blue" href="/orders" />
        <StatCard label="الطلبات قيد التنفيذ" value={stats ? String(stats.orders_pending) : "—"} icon={Activity} note="بحاجة لمتابعة" accent="amber" href="/order-tracking" />
        <StatCard label="إيرادات اليوم" value={stats ? `${stats.revenue_today} ج.م` : "—"} icon={TrendingUp} note="بدون الملغي" accent="green" href="/finance" />
        <StatCard label="التصنيفات" value={stats ? String(stats.categories) : "—"} icon={Tag} note="نشطة" accent="blue" href="/categories" />
        <StatCard label="العروض" value={stats ? String(stats.offers) : "—"} icon={ShoppingCart} note="عروض فعّالة" accent="brand" href="/offers" />
        <StatCard label="أكواد الخصم" value={stats ? String(stats.vouchers) : "—"} icon={BadgePercent} note="كوبونات" accent="violet" href="/promo-codes" />
        <StatCard label="التقييمات" value={stats ? String(stats.ratings_total) : "—"} icon={Star} note="من عملاء حقيقيين" accent="amber" href="/reviews" />
      </section>

      {/* Orders + Offers */}
      <section className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard title="الطلبات النشطة" icon={ClipboardList} href="/orders">
          {ordersQuery.isError ? (
            <PanelEmpty text="تعذّر تحميل الطلبات" />
          ) : ordersQuery.isLoading ? (
            <PanelEmpty text="جاري التحميل…" />
          ) : activeOrders.length === 0 ? (
            <PanelEmpty text="لا توجد طلبات نشطة حالياً" />
          ) : (
            <div className="space-y-1">
              {activeOrders.map((o) => (
                <Link
                  key={o.id}
                  href="/orders"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <ClipboardList className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{o.id.slice(0, 8)}</span>
                      <Badge variant={statusVariant[o.status]}>{statusLabels[o.status]}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {o.delivery_address || o.contact_phone || "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-sm font-bold tabular-nums">{o.total_amount} ج.م</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(o.created_at, locale)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="العروض الفعّالة" icon={Gift} href="/offers">
          {offersQuery.isError ? (
            <PanelEmpty text="تعذّر تحميل العروض" />
          ) : offersQuery.isLoading ? (
            <PanelEmpty text="جاري التحميل…" />
          ) : activeOffers.length === 0 ? (
            <PanelEmpty text="لا توجد عروض فعّالة" />
          ) : (
            <div className="space-y-1">
              {activeOffers.map((offer) => (
                <Link
                  key={offer.id}
                  href="/offers"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
                >
                  {offer.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={offer.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Gift className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {locale === "ar" ? offer.title_ar : offer.title_en || offer.title_ar}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{restaurantName(offer.restaurant_id)}</p>
                  </div>
                  <Badge variant="success" className="shrink-0">
                    خصم {offer.discount_percentage}%
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </section>

      {/* Active users + Latest restaurants */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="أحدث المستخدمين النشطين" icon={Users} href="/users">
          {usersQuery.isError ? (
            <PanelEmpty text="تعذّر تحميل المستخدمين" />
          ) : usersQuery.isLoading ? (
            <PanelEmpty text="جاري التحميل…" />
          ) : activeUsers.length === 0 ? (
            <PanelEmpty text="لا يوجد مستخدمون نشطون" />
          ) : (
            <div className="space-y-1">
              {activeUsers.map((u) => (
                <Link
                  key={u.id}
                  href="/users"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary">
                    {initials(u.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{u.full_name || "بدون اسم"}</p>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">
                      {u.phone || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={roleVariant[u.role] ?? "outline"}>
                      {roleLabels[u.role] ?? u.role}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{formatDate(u.created_at, locale)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="أحدث المطاعم" icon={Store} href="/restaurants">
          {restaurantsQuery.isError ? (
            <PanelEmpty text="تعذّر تحميل المطاعم" />
          ) : restaurantsQuery.isLoading ? (
            <PanelEmpty text="جاري التحميل…" />
          ) : latestRestaurants.length === 0 ? (
            <PanelEmpty text="لا توجد مطاعم بعد" />
          ) : (
            <div className="space-y-1">
              {latestRestaurants.map((r) => (
                <Link
                  key={r.id}
                  href="/restaurants"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
                >
                  {r.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Store className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {locale === "ar" ? r.name_ar : r.name_en || r.name_ar}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">عمولة {r.commission_percentage}%</p>
                  </div>
                  <Badge variant={r.is_active ? "success" : "secondary"} className="shrink-0">
                    {r.is_active ? "مفعّل" : "متوقف"}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </section>

      {!isError && !stats ? (
        <section className="mt-6 rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          <p>جاري تحميل الإحصائيات من Supabase…</p>
          <p className="mt-1 text-xs">إذا استمر التحميل، تأكد أنك مسجل دخول كأدمن أو شغّل الـ JWT Hook أولاً.</p>
        </section>
      ) : null}
    </AppShell>
  );
}
