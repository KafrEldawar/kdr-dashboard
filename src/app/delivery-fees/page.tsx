import { AppShell } from "@/components/layout/app-shell";
import { DeliveryFeesModule } from "@/modules/delivery-fees/delivery-fees-module";

export default function DeliveryFeesPage() {
  return (
    <AppShell>
      <DeliveryFeesModule />
    </AppShell>
  );
}
