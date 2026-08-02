import { AppShell } from "@/components/layout/app-shell";
import { DeliveryProvidersModule } from "@/modules/delivery-providers/delivery-providers-module";

export default function DeliveryProvidersPage() {
  return (
    <AppShell>
      <DeliveryProvidersModule />
    </AppShell>
  );
}
