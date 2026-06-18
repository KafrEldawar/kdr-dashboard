import { AppShell } from "@/components/layout/app-shell";
import { CampaignsModule } from "@/modules/campaigns/campaigns-module";

export default function CampaignsPage() {
  return (
    <AppShell>
      <CampaignsModule />
    </AppShell>
  );
}
