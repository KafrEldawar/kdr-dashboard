import { createTableService } from "@/services/base-table.service";

export const ordersService = createTableService({
  table: "orders",
  defaultSort: "created_at",
  searchColumns: [
    "status",
    "delivery_address",
    "contact_phone",
    "alternate_phone",
    "notes",
  ],
});
