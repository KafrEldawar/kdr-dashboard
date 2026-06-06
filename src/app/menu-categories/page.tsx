import { AppShell } from "@/components/layout/app-shell";
import { MenuCategoriesModule } from "@/modules/menu-categories/menu-categories-module";

export default function MenuCategoriesPage() {
  return (
    <AppShell>
      <MenuCategoriesModule />
    </AppShell>
  );
}
