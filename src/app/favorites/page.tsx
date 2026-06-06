import { AppShell } from "@/components/layout/app-shell";
import { FavoritesModule } from "@/modules/favorites/favorites-module";

export default function FavoritesPage() {
  return (
    <AppShell>
      <FavoritesModule />
    </AppShell>
  );
}
