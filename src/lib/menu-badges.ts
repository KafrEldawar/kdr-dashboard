// Menu item badge catalog (dashboard side).
//
// A menu item may carry ONE badge, stored on `menu_items.badge_type`
// (a preset key or 'custom') + `menu_items.badge_label_ar` (free text
// used only for 'custom'). Preset labels/styles live here so the look
// can change with no DB migration. Keep the preset keys in sync with
// the mobile app's MenuItemBadge helper.

export const MENU_BADGE_PRESETS = [
  "best_seller",
  "special_offer",
  "new",
  "recommended",
] as const;

export type MenuBadgePreset = (typeof MENU_BADGE_PRESETS)[number];
export type MenuBadgeType = MenuBadgePreset | "custom";

export const MENU_BADGE_META: Record<
  MenuBadgePreset,
  { label: string; className: string }
> = {
  best_seller: {
    label: "الأكثر مبيعاً",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900",
  },
  special_offer: {
    label: "عرض خاص",
    className:
      "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900",
  },
  new: {
    label: "جديد",
    className:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900",
  },
  recommended: {
    label: "نرشّحه",
    className:
      "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-900",
  },
};

/** Display label for a badge, or null when the item has no badge. */
export function menuBadgeLabel(
  type?: string | null,
  customLabel?: string | null
): string | null {
  if (!type) return null;
  if (type === "custom") return (customLabel || "").trim() || "بادج";
  return MENU_BADGE_META[type as MenuBadgePreset]?.label ?? type;
}

/** Tailwind classes for the badge pill of a given type. */
export function menuBadgeClassName(type?: string | null): string {
  if (!type) return "";
  if (type === "custom")
    return "bg-primary/10 text-primary border-primary/20";
  return (
    MENU_BADGE_META[type as MenuBadgePreset]?.className ??
    "bg-muted text-foreground"
  );
}
