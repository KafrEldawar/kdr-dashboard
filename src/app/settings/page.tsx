import { AppShell } from "@/components/layout/app-shell";
import { SettingsModule } from "@/modules/settings/settings-module";

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsModule />
    </AppShell>
  );
}
