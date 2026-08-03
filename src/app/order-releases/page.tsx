import { AppShell } from "@/components/layout/app-shell";
import { OrderReleasesModule } from "@/modules/order-releases/order-releases-module";

export default function OrderReleasesPage() {
  return (
    <AppShell>
      <OrderReleasesModule />
    </AppShell>
  );
}
