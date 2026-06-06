import { createTableService } from "@/services/base-table.service";

export const branchesService = createTableService({
  table: "branches",
  defaultSort: "created_at",
  searchColumns: ["name_ar", "name_en", "address_ar", "address_en"],
});
