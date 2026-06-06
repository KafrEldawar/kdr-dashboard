import { AppShell } from "@/components/layout/app-shell";
import { CategoriesModule } from "@/modules/categories/categories-module";

export default function CategoriesPage() {
  return (
    <AppShell>
      <CategoriesModule />
    </AppShell>
  );
}
