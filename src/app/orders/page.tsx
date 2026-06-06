import { AppShell } from "@/components/layout/app-shell";
import { OrdersModule } from "@/modules/orders/orders-module";

export default function OrdersPage() {
  return (
    <AppShell>
      <OrdersModule />
    </AppShell>
  );
}
