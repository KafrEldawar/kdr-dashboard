import { createTableService } from "@/services/base-table.service";

export const restaurantsService = createTableService({
  table: "restaurants",
  defaultSort: "created_at",
  searchColumns: ["name_ar", "name_en", "description_ar", "description_en"],
});
