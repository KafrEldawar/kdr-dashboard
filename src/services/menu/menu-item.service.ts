import { createTableService } from "@/services/base-table.service";

export const menuItemsService = createTableService({
  table: "menu_items",
  defaultSort: "created_at",
  searchColumns: ["name_ar", "name_en", "description_ar", "description_en"],
});
