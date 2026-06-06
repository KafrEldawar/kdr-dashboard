import type { Locale } from "@/lib/i18n/messages";

const dateFormatters: Record<Locale, Intl.DateTimeFormat> = {
  ar: new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }),
  en: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }),
};

const notSetLabels: Record<Locale, string> = {
  ar: "غير محدد",
  en: "Not set",
};

export function formatDate(value: string | null, locale: Locale = "ar"): string {
  if (!value) return notSetLabels[locale];
  return dateFormatters[locale].format(new Date(value));
}

// Kept for backwards compatibility — defaults to Arabic
export function formatEgyptDate(value: string | null): string {
  return formatDate(value, "ar");
}
