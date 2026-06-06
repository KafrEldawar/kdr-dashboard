import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed bg-background p-8 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground" />
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
