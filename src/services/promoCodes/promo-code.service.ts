import { createTableService } from "@/services/base-table.service";

export const promoCodesService = createTableService({
  table: "vouchers",
  defaultSort: "created_at",
  searchColumns: ["code"],
});
