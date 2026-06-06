import { AppShell } from "@/components/layout/app-shell";
import { BranchesModule } from "@/modules/branches/branches-module";

export default function BranchesPage() {
  return (
    <AppShell>
      <BranchesModule />
    </AppShell>
  );
}
