"use client";

import { useEffect } from "react";
import { useLangStore } from "@/store/lang-store";

export function LangSync() {
  const locale = useLangStore((s) => s.locale);

  useEffect(() => {
    const html = document.documentElement;
    if (locale === "ar") {
      html.lang = "ar-EG";
      html.dir = "rtl";
    } else {
      html.lang = "en";
      html.dir = "ltr";
    }
  }, [locale]);

  return null;
}
