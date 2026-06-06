"use client";

import { useRef, useState } from "react";
import { Upload, X, ImageIcon } from "lucide-react";
import { requireSupabase } from "@/lib/supabase/client";

export type ImageUploadType =
  | "restaurant_logo"
  | "restaurant_cover"
  | "menu_item"
  | "category"
  | "offer"
  | "avatar";

type ImageUploaderProps = {
  value?: string | null;
  onChange: (url: string) => void;
  type: ImageUploadType;
  entityId?: string;
  label?: string;
  variant?: "square" | "cover" | "logo";
};

export function ImageUploader({
  value,
  onChange,
  type,
  entityId,
  label,
  variant = "square",
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const supabase = requireSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) { setError("غير مصرح"); return; }

      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      if (entityId) form.append("entity_id", entityId);

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const res = await fetch(`${supabaseUrl}/functions/v1/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const result = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !result.url) { setError(result.error ?? "فشل رفع الصورة"); return; }
      onChange(result.url);
    } catch {
      setError("حدث خطأ أثناء رفع الصورة");
    } finally {
      setUploading(false);
    }
  }

  const containerClass =
    variant === "cover"
      ? "h-36 w-full"
      : variant === "logo"
        ? "h-20 w-20 rounded-full overflow-hidden"
        : "h-24 w-24 rounded-lg overflow-hidden";

  return (
    <div className="space-y-1.5">
      {label ? <p className="text-sm font-medium">{label}</p> : null}
      <div
        className={`relative cursor-pointer border-2 border-dashed bg-muted/30 transition-colors hover:bg-muted/50 ${containerClass} ${variant !== "logo" ? "rounded-lg" : ""}`}
        onClick={() => !uploading && inputRef.current?.click()}
      >
        {value ? (
          <>
            <img src={value} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
            {uploading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Upload className="h-5 w-5" />
            )}
            <p className="text-center text-xs leading-tight px-2">
              {uploading ? "جاري الرفع…" : "اضغط لرفع صورة"}
            </p>
          </div>
        )}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
