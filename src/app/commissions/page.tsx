import { AppShell } from "@/components/layout/app-shell";
import { CommissionsModule } from "@/modules/commissions/commissions-module";

export default function CommissionsPage() {
  return (
    <AppShell>
      <CommissionsModule />
    </AppShell>
  );
}
