import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AuthGuard } from "@/components/layout/auth-guard";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-muted/40">
        <Sidebar />
        <div className="lg:ps-72">
          <Header />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div key="page" className="animate-in-up">{children}</div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
