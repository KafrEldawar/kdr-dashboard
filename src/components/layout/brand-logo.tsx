import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  /** logo mark size in px */
  size?: number;
  /** show the "KDR / مطاعم كفر الدوار" wordmark next to the mark */
  withWordmark?: boolean;
  subtitle?: string;
};

export function BrandLogo({
  className,
  size = 40,
  withWordmark = false,
  subtitle = "مطاعم كفر الدوار",
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/kdr-logo.svg"
        alt="KDR"
        width={size}
        height={size}
        className="shrink-0 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        style={{ width: size, height: size }}
      />
      {withWordmark ? (
        <span className="flex flex-col leading-none">
          <span className="text-lg font-extrabold tracking-tight">KDR</span>
          <span className="mt-1 text-[11px] font-medium text-muted-foreground">
            {subtitle}
          </span>
        </span>
      ) : null}
    </span>
  );
}
