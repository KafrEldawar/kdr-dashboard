import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="dot-grid flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Inbox className="h-7 w-7" />
      </span>
      <h3 className="mt-4 text-base font-bold">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
