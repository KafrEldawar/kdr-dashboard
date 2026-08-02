import { AppShell } from "@/components/layout/app-shell";
import { ProductAnalyticsModule } from "@/modules/product-analytics/product-analytics-module";

export default function ProductAnalyticsPage() {
  return (
    <AppShell>
      <ProductAnalyticsModule />
    </AppShell>
  );
}
