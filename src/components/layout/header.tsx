"use client";

import { Database, LogOut, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { useTranslations } from "@/lib/i18n";
import { LangSwitcher } from "@/components/layout/lang-switcher";
import { Button } from "@/components/ui/button";

async function handleLogout() {
  await supabase?.auth.signOut();
  window.location.href = "/login";
}

export function Header() {
  const t = useTranslations();

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {t("layout.restaurantName")}
          </p>
          <h1 className="text-base font-semibold">{t("layout.headerTitle")}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden items-center gap-2 rounded-md border px-3 py-2 text-muted-foreground sm:flex">
            <Database className="h-4 w-4" />
            {isSupabaseConfigured
              ? t("layout.supabaseConnected")
              : t("layout.supabaseNotConfigured")}
          </span>
          <span className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-primary-foreground">
            <ShieldCheck className="h-4 w-4" />
            {t("layout.internal")}
          </span>
          <LangSwitcher />
          <Button size="sm" variant="ghost" onClick={handleLogout} title="تسجيل الخروج">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
