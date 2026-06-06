import { AppShell } from "@/components/layout/app-shell";
import { WorkingHoursModule } from "@/modules/working-hours/working-hours-module";

export default function WorkingHoursPage() {
  return (
    <AppShell>
      <WorkingHoursModule />
    </AppShell>
  );
}
