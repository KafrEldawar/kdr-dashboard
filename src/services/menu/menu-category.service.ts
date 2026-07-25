import { createTableService } from "@/services/base-table.service";

// Menu-item categories are now an INDEPENDENT global taxonomy backed by
// `menu_categories` (migration 059). Kept separate from `categories`
// (restaurant tags) so admins can curate the two lists on their own —
// what appears in an owner's category picker is not the same list that
// tags a restaurant on the customer home grid.
export const menuCategoriesService = createTableService({
  table: "menu_categories",
  defaultSort: "sort_order",
  searchColumns: ["name_ar", "name_en"],
});
