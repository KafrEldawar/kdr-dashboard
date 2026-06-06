"use client";

import { useCallback } from "react";
import { useLangStore } from "@/store/lang-store";
import { messages, type MessageKey, type Locale } from "./messages";

export type { MessageKey, Locale };

export function useTranslations() {
  const locale = useLangStore((s) => s.locale);
  return useCallback(
    (key: MessageKey) => messages[locale][key] as string,
    [locale]
  );
}

export function useLocale(): Locale {
  return useLangStore((s) => s.locale);
}
