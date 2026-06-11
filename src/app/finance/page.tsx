import { AppShell } from "@/components/layout/app-shell";
import { FinanceModule } from "@/modules/finance/finance-module";

export default function FinancePage() {
  return (
    <AppShell>
      <FinanceModule />
    </AppShell>
  );
}
