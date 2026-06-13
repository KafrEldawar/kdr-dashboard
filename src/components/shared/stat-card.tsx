import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowUpLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
  accent?: "brand" | "blue" | "green" | "amber" | "violet";
  href?: string;
};

const accentMap: Record<NonNullable<StatCardProps["accent"]>, string> = {
  brand: "bg-primary/10 text-primary",
  blue: "bg-[hsl(var(--chart-4)/0.12)] text-[hsl(var(--chart-4))]",
  green: "bg-success/12 text-success",
  amber: "bg-warning/12 text-warning",
  violet: "bg-[hsl(var(--chart-5)/0.14)] text-[hsl(var(--chart-5))]",
};

export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  accent = "brand",
  href,
}: StatCardProps) {
  const base =
    "group relative block overflow-hidden rounded-xl border border-border bg-card p-5 card-elevated transition-all";

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
          {note ? <p className="mt-1.5 truncate text-xs text-muted-foreground">{note}</p> : null}
        </div>
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-110",
            accentMap[accent]
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-primary transition-transform duration-300 group-hover:scale-x-100" />
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={label}
        className={cn(
          base,
          "hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        )}
      >
        {inner}
        <ArrowUpLeft className="absolute bottom-3 start-4 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    );
  }

  return <div className={base}>{inner}</div>;
}
