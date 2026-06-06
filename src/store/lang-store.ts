import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Locale } from "@/lib/i18n/messages";

type LangStore = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

export const useLangStore = create<LangStore>()(
  persist(
    (set) => ({
      locale: "ar" as Locale,
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "kdr-lang",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
      ),
    }
  )
);
