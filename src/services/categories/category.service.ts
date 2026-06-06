import { createTableService } from "@/services/base-table.service";

export const categoriesService = createTableService({
  table: "categories",
  defaultSort: "sort_order",
  searchColumns: ["name_ar", "name_en"],
});
