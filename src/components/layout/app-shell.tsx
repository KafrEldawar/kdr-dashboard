"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AuthGuard } from "@/components/layout/auth-guard";
import { useSidebarStore } from "@/store/sidebar-store";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarStore((s) => s.collapsed);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-muted/40">
        <Sidebar />
        <div className={cn("transition-[padding] duration-300", collapsed ? "lg:ps-20" : "lg:ps-72")}>
          <Header />
          <main className="w-full px-4 py-6 sm:px-12 lg:px-16">
            <div key="page" className="animate-in-up">{children}</div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
