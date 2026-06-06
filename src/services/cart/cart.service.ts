import { createTableService } from "@/services/base-table.service";

export const cartService = createTableService({
  table: "cart_items",
  defaultSort: "created_at",
});
