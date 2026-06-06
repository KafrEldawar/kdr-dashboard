import { AppShell } from "@/components/layout/app-shell";
import { QueryLabModule } from "@/modules/query-lab/query-lab-module";

export default function QueryLabPage() {
  return (
    <AppShell>
      <QueryLabModule />
    </AppShell>
  );
}
