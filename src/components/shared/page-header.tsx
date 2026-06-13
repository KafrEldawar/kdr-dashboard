import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageHeaderProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  action?: React.ReactNode;
  icon?: LucideIcon;
};

export function PageHeader({
  title,
  description,
  actionLabel,
  onAction,
  action,
  icon: Icon,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3.5">
        {Icon ? (
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-[22px] w-[22px]" />
          </span>
        ) : null}
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="shrink-0">
        {action ?? (actionLabel ? <Button onClick={onAction}>{actionLabel}</Button> : null)}
      </div>
    </div>
  );
}
