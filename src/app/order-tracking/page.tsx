import { AppShell } from "@/components/layout/app-shell";
import { OrderTrackingModule } from "@/modules/order-tracking/order-tracking-module";

export default function OrderTrackingPage() {
  return (
    <AppShell>
      <OrderTrackingModule />
    </AppShell>
  );
}
