"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "@/components/layout/nav-items";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-72 border-e bg-background lg:block">
      <div className="flex h-16 items-center border-b px-6">
        <div>
          <p className="text-sm font-semibold">{t("layout.appTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("layout.appSubtitle")}</p>
        </div>
      </div>
      <nav className="h-[calc(100vh-4rem)] space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground",
                active &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{t(item.titleKey)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
