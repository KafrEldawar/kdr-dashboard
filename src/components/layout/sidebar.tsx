"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  navItems,
  navGroupLabels,
  navGroupOrder,
  type NavGroup,
} from "@/components/layout/nav-items";
import { BrandLogo } from "@/components/layout/brand-logo";
import { useTranslations, useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center border-b border-border px-5">
        <Link href="/" onClick={onNavigate} className="group">
          <BrandLogo size={38} withWordmark />
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {navGroupOrder.map((group: NavGroup) => {
          const items = navItems.filter((i) => i.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                {navGroupLabels[group][locale]}
              </p>
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
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      {active ? (
                        <span className="absolute inset-y-2 -start-3 w-1 rounded-full bg-primary-foreground/80" />
                      ) : null}
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110",
                          active ? "text-primary-foreground" : "text-muted-foreground"
                        )}
                      />
                      <span className="truncate">{t(item.titleKey)}</span>
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
        <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2 4 5v6c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V5l-8-3Z" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold">{locale === "ar" ? "نظام آمن" : "Secure system"}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {locale === "ar" ? "لوحة إدارة داخلية" : "Internal admin"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-72 border-e border-border bg-card lg:block">
      <SidebarNav />
    </aside>
  );
}
