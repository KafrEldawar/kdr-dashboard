import { AppShell } from "@/components/layout/app-shell";
import { PromoCodesModule } from "@/modules/promo-codes/promo-codes-module";

export default function PromoCodesPage() {
  return (
    <AppShell>
      <PromoCodesModule />
    </AppShell>
  );
}
