import { AppShell } from "@/components/layout/app-shell";
import { CampaignDetailModule } from "@/modules/campaigns/campaign-detail-module";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <CampaignDetailModule campaignId={id} />
    </AppShell>
  );
}
