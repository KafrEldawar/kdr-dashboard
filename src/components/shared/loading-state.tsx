"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "@/lib/i18n";

export function LoadingState({ label }: { label?: string }) {
  const t = useTranslations();

  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label ?? t("common.loading")}
      </div>
    </div>
  );
}
