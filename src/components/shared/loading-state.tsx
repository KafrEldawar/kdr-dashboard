"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "@/lib/i18n";

export function LoadingState({ label }: { label?: string }) {
  const t = useTranslations();

  return (
    <div className="flex min-h-48 items-center justify-center rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        {label ?? t("common.loading")}
      </div>
    </div>
  );
}
