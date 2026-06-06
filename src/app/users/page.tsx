import { AppShell } from "@/components/layout/app-shell";
import { UsersModule } from "@/modules/users/users-module";

export default function UsersPage() {
  return (
    <AppShell>
      <UsersModule />
    </AppShell>
  );
}
