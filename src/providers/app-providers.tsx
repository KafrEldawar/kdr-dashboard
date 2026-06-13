"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { LangSync } from "@/components/layout/lang-sync";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { AuthProvider } from "./auth-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <LangSync />
          {children}
          <Toaster richColors position="top-right" closeButton theme="system" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
