import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsModule } from "@/modules/analytics/analytics-module";

export default function AnalyticsPage() {
  return (
    <AppShell>
      <AnalyticsModule />
    </AppShell>
  );
}
