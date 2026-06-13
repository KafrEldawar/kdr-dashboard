"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import {
  navItems,
  navGroupLabels,
  navGroupOrder,
  type NavGroup,
} from "@/components/layout/nav-items";
import { BrandLogo } from "@/components/layout/brand-logo";
import { useSidebarStore } from "@/store/sidebar-store";
import { useTranslations, useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const toggle = useSidebarStore((s) => s.toggle);

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "justify-between px-5"
        )}
      >
        <Link href="/" onClick={onNavigate} className="group">
          {collapsed ? <BrandLogo size={36} /> : <BrandLogo size={38} withWordmark />}
        </Link>
        {!collapsed ? (
          <button
            type="button"
            onClick={toggle}
            aria-label="طي القائمة"
            title="طي القائمة"
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex"
          >
            <PanelLeftClose className="h-[18px] w-[18px]" />
          </button>
        ) : null}
      </div>

      {/* Expand button (collapsed only) */}
      {collapsed ? (
        <button
          type="button"
          onClick={toggle}
          aria-label="توسيع القائمة"
          title="توسيع القائمة"
          className="mx-auto mt-3 hidden h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex"
        >
          <PanelLeftOpen className="h-[18px] w-[18px]" />
        </button>
      ) : null}

      {/* Nav */}
      <nav className={cn("flex-1 overflow-y-auto py-4", collapsed ? "space-y-2 px-2" : "space-y-6 px-3")}>
        {navGroupOrder.map((group: NavGroup, gi) => {
          const items = navItems.filter((i) => i.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              {collapsed ? (
                gi > 0 ? <div className="mx-2 mb-2 border-t border-border" /> : null
              ) : (
                <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {navGroupLabels[group][locale]}
                </p>
              )}
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? t(item.titleKey) : undefined}
                      aria-label={collapsed ? t(item.titleKey) : undefined}
                      className={cn(
                        "group relative flex items-center rounded-xl text-sm font-semibold transition-all",
                        collapsed ? "mx-auto h-11 w-11 justify-center" : "gap-3 px-3 py-2.5",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      {active && !collapsed ? (
                        <span className="absolute inset-y-2 -start-3 w-1 rounded-full bg-primary-foreground/80" />
                      ) : null}
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110",
                          active ? "text-primary-foreground" : "text-muted-foreground"
                        )}
                      />
                      {!collapsed ? <span className="truncate">{t(item.titleKey)}</span> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-3">
        {collapsed ? (
          <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary" title={locale === "ar" ? "نظام آمن" : "Secure system"}>
            <ShieldCheck className="h-4 w-4" />
          </span>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{locale === "ar" ? "نظام آمن" : "Secure system"}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {locale === "ar" ? "لوحة إدارة داخلية" : "Internal admin"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  return (
    <aside
      className={cn(
        "fixed inset-y-0 start-0 z-30 hidden border-e border-border bg-card transition-[width] duration-300 lg:block",
        collapsed ? "w-20" : "w-72"
      )}
    >
      <SidebarNav collapsed={collapsed} />
    </aside>
  );
}
