"use client";

import { CategoriesModule } from "@/modules/categories/categories-module";

// Menu-item categories are their OWN admin-managed taxonomy since
// migration 059 — no longer a shim over `categories` (which now
// only holds restaurant tags). Kept on the same UI shell so the
// two admin surfaces feel identical, but every write here goes to
// `menu_categories` via rpc_admin_manage_menu_category.
export function MenuCategoriesModule() {
  return (
    <CategoriesModule
      kind="menu"
      title="تصنيفات المنيو"
      description="التصنيفات اللي بتظهر كأقسام جوة منيو المطاعم. مستقلة تماماً عن تصنيفات المطاعم اللي بتظهر ك chips في الهوم."
    />
  );
}
