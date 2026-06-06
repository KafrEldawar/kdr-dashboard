import { createTableService } from "@/services/base-table.service";

export const offersService = createTableService({
  table: "offers",
  defaultSort: "start_date",
  searchColumns: ["title_ar", "title_en", "description_ar", "description_en"],
});
