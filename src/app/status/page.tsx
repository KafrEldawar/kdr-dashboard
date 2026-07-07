import { AppShell } from "@/components/layout/app-shell";
import { StatusModule } from "@/modules/status/status-module";

export default function StatusPage() {
  return (
    <AppShell>
      <StatusModule />
    </AppShell>
  );
}
