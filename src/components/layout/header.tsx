"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Database, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { useTranslations } from "@/lib/i18n";
import { LangSwitcher } from "@/components/layout/lang-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SidebarNav } from "@/components/layout/sidebar";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Button } from "@/components/ui/button";

async function handleLogout() {
  await supabase?.auth.signOut();
  window.location.href = "/login";
}

export function Header() {
  const t = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          {/* Mobile menu */}
          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger asChild>
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-muted lg:hidden"
                aria-label="القائمة"
              >
                <Menu className="h-5 w-5" />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-overlay-in lg:hidden" />
              <Dialog.Content className="fixed inset-y-0 start-0 z-50 w-72 border-e border-border bg-card shadow-2xl animate-drawer-in lg:hidden">
                <Dialog.Title className="sr-only">القائمة</Dialog.Title>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="absolute end-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
                <SidebarNav onNavigate={() => setMenuOpen(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          {/* Logo on mobile (sidebar is hidden) */}
          <div className="lg:hidden">
            <BrandLogo size={34} />
          </div>

          <div className="hidden lg:block">
            <p className="text-xs font-medium text-muted-foreground">
              {t("layout.restaurantName")}
            </p>
            <h1 className="text-base font-bold tracking-tight">{t("layout.headerTitle")}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm sm:gap-3">
          <span
            className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold sm:flex ${
              isSupabaseConfigured
                ? "border-success/30 bg-success/10 text-success"
                : "border-warning/30 bg-warning/10 text-warning"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${isSupabaseConfigured ? "bg-success" : "bg-warning"}`} />
            <Database className="h-3.5 w-3.5" />
            {isSupabaseConfigured
              ? t("layout.supabaseConnected")
              : t("layout.supabaseNotConfigured")}
          </span>
          <span className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary md:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("layout.internal")}
          </span>
          <ThemeToggle />
          <LangSwitcher />
          <Button size="icon" variant="ghost" onClick={handleLogout} title="تسجيل الخروج" className="text-muted-foreground hover:text-destructive">
            <LogOut className="h-[18px] w-[18px]" />
          </Button>
        </div>
      </div>
    </header>
  );
}
