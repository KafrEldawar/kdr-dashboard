"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/lib/i18n";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  const t = useTranslations();

  return (
    <div className="relative w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="ps-9"
        value={value}
        placeholder={placeholder ?? t("common.search")}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
