import { AppShell } from "@/components/layout/app-shell";
import { SupportInboxModule } from "@/modules/support-inbox/support-inbox-module";

export default function SupportInboxPage() {
  return (
    <AppShell>
      <SupportInboxModule />
    </AppShell>
  );
}
