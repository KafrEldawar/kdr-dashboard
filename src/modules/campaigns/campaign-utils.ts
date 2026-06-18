import type { CampaignStatus, RecipientStatus, CampaignTargetType } from "@/services/campaigns";

export const statusLabel: Record<CampaignStatus, string> = {
  draft: "مسودة",
  scheduled: "مجدولة",
  running: "جارية",
  paused: "متوقفة",
  completed: "مكتملة",
  failed: "فشلت",
};

export const statusBadgeVariant: Record<
  CampaignStatus,
  "default" | "secondary" | "outline" | "success" | "destructive"
> = {
  draft: "outline",
  scheduled: "secondary",
  running: "default",
  paused: "outline",
  completed: "success",
  failed: "destructive",
};

export const recipientStatusLabel: Record<RecipientStatus, string> = {
  pending: "بانتظار الإرسال",
  sent: "تم الإرسال",
  failed: "فشل",
  skipped: "تم التخطي",
};

export const recipientBadgeVariant: Record<
  RecipientStatus,
  "default" | "secondary" | "outline" | "success" | "destructive"
> = {
  pending: "outline",
  sent: "success",
  failed: "destructive",
  skipped: "secondary",
};

export const targetTypeLabel: Record<CampaignTargetType, string> = {
  all_customers: "كل العملاء",
  role_filter: "حسب الدور",
  custom_list: "قائمة مخصصة",
};

/**
 * Egypt-friendly E.164 normalization shared with Flutter and Edge Functions.
 * Accepts: 01XXXXXXXXX, +201XXXXXXXXX, 00201XXXXXXXXX, 201XXXXXXXXX.
 * Returns: '+201XXXXXXXXX' or null if invalid.
 */
export function normalizePhoneEG(input: string): string | null {
  const trimmed = (input || "").trim().replace(/[\s\-()]/g, "");
  if (!trimmed) return null;

  let digits = trimmed;
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01[0-2,5]\d{8}$/.test(digits)) digits = "20" + digits.slice(1);
  if (/^1[0-2,5]\d{8}$/.test(digits)) digits = "20" + digits;
  if (!/^\d{10,15}$/.test(digits)) return null;
  return "+" + digits;
}

/**
 * Parse a raw textarea / CSV-ish input into deduped phone+name rows.
 * Lines look like "+201234567890" or "+201234567890,Mohamed" or
 * "01234567890;Mohamed".
 */
export function parsePhonesInput(raw: string): { phones: string[]; names: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const phones: string[] = [];
  const names: string[] = [];
  const invalid: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[,;\t]/).map((s) => s.trim());
    const rawPhone = parts[0];
    const name = parts[1] ?? "";
    const e164 = normalizePhoneEG(rawPhone);
    if (!e164) {
      invalid.push(rawPhone);
      continue;
    }
    if (seen.has(e164)) continue;
    seen.add(e164);
    phones.push(e164);
    names.push(name);
  }
  return { phones, names, invalid };
}
