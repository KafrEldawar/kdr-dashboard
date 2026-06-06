import { AppShell } from "@/components/layout/app-shell";
import { RestaurantsModule } from "@/modules/restaurants/restaurants-module";

export default function RestaurantsPage() {
  return (
    <AppShell>
      <RestaurantsModule />
    </AppShell>
  );
}
