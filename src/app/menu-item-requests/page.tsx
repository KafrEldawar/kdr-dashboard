import { AppShell } from "@/components/layout/app-shell";
import { MenuItemRequestsModule } from "@/modules/menu-item-requests/menu-item-requests-module";

export default function MenuItemRequestsPage() {
  return (
    <AppShell>
      <MenuItemRequestsModule />
    </AppShell>
  );
}
