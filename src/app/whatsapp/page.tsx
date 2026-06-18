import { AppShell } from "@/components/layout/app-shell";
import { WhatsappConnectionModule } from "@/modules/whatsapp/whatsapp-connection-module";

export default function WhatsappPage() {
  return (
    <AppShell>
      <WhatsappConnectionModule />
    </AppShell>
  );
}
