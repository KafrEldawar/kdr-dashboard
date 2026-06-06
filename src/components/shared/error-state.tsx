"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/lib/i18n";

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  const t = useTranslations();

  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border bg-background p-8 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <h3 className="mt-4 text-base font-semibold">{title ?? t("common.error")}</h3>
      {description ? (
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>
      ) : null}
      {onRetry ? (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}
