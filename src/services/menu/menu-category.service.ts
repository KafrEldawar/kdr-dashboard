import { createTableService } from "@/services/base-table.service";

// In the KDR schema, menu item categories are the global categories table.
// menu_categories table does not exist — use categoriesService instead.
export const menuCategoriesService = createTableService({
  table: "categories",
  defaultSort: "sort_order",
  searchColumns: ["name_ar", "name_en"],
});
