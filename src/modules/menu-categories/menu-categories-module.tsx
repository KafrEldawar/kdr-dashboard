"use client";

import { CategoriesModule } from "@/modules/categories/categories-module";

// Menu-item categories ARE the shared global `categories` in the current
// schema: every menu item links to `categories`, and an owner's typed
// custom category is promoted into this same list on approval
// (migration 057). So this page is the full category manager, just
// framed as "menu categories" — managing a category here or on
// /categories affects the same data.
export function MenuCategoriesModule() {
  return (
    <CategoriesModule
      title="تصنيفات المنيو"
      description="التصنيفات اللي بتظهر كأقسام في منيو المطاعم. أضِف/عدّل/فعّل أو أوقف تصنيف — دي نفس التصنيفات العامة اللي بيختار منها أصحاب المطاعم."
    />
  );
}
