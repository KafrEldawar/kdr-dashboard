"use client";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLangStore } from "@/store/lang-store";
import { useTranslations } from "@/lib/i18n";

export function LangSwitcher() {
  const { locale, setLocale } = useLangStore();
  const t = useTranslations();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
      aria-label="Switch language"
    >
      <Languages className="h-4 w-4" />
      <span>{t("layout.switchLang")}</span>
    </Button>
  );
}
