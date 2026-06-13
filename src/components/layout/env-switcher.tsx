"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FlaskConical, Server } from "lucide-react";
import {
  activeEnv,
  isDevEnvAvailable,
  setActiveEnv,
  type SupabaseEnv,
} from "@/lib/supabase/client";

export function EnvSwitcher() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  if (!mounted) return null;

  const devAvailable = isDevEnvAvailable();
  const isDev = activeEnv === "dev";
  const disabled = !devAvailable && !isDev;

  const select = (env: SupabaseEnv) => {
    setOpen(false);
    if (env === activeEnv) return;
    setActiveEnv(env);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
          isDev
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
            : "border-border bg-muted/40 text-foreground hover:bg-muted"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        title={
          !devAvailable
            ? "أضف NEXT_PUBLIC_SUPABASE_URL_DEV لـ .env.local لتفعيل التبديل"
            : isDev
            ? "تشتغل على بيئة التطوير"
            : "تشتغل على بيئة الإنتاج"
        }
      >
        {isDev ? <FlaskConical className="h-3.5 w-3.5" /> : <Server className="h-3.5 w-3.5" />}
        <span>{isDev ? "DEV" : "PROD"}</span>
      </button>

      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 min-w-[200px] overflow-hidden rounded-lg border border-border bg-popover p-1 text-sm shadow-lg">
          <EnvOption
            label="Production"
            description="البيانات الحقيقية"
            icon={<Server className="h-4 w-4" />}
            active={!isDev}
            onSelect={() => select("prod")}
          />
          <EnvOption
            label="Development"
            description="للتجارب — آمن"
            icon={<FlaskConical className="h-4 w-4 text-destructive" />}
            active={isDev}
            onSelect={() => select("dev")}
            disabled={!devAvailable}
          />
        </div>
      )}
    </div>
  );
}

function EnvOption({
  label,
  description,
  icon,
  active,
  onSelect,
  disabled,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  active: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-start text-sm outline-none hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5">{icon}</span>
      <span className="flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      {active && <Check className="mt-1 h-4 w-4 text-primary" />}
    </button>
  );
}

export function DevEnvBanner() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || activeEnv !== "dev") return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-destructive py-1.5 text-xs font-bold uppercase tracking-wider text-destructive-foreground">
      <FlaskConical className="h-3.5 w-3.5" />
      DEV ENVIRONMENT — البيانات تجريبية
    </div>
  );
}
