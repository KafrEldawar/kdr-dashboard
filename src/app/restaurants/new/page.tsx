"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Store } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { AddRestaurantWizard } from "@/modules/restaurants/add-restaurant-wizard";

export default function NewRestaurantPage() {
  const router = useRouter();
  const back = () => router.push("/restaurants");

  return (
    <AppShell>
      <Button variant="ghost" size="sm" onClick={back} className="mb-3 -ms-2 text-muted-foreground">
        <ArrowRight className="h-4 w-4" />
        رجوع لقائمة المطاعم
      </Button>

      <PageHeader
        icon={Store}
        title="إضافة مطعم جديد"
        description="أنشئ مطعماً كاملاً عبر الخطوات: البيانات الأساسية، الفروع، المنيو، ومعرض الصور."
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card card-elevated">
        <div className="flex h-[calc(100vh-15rem)] min-h-[560px] flex-col">
          <AddRestaurantWizard onSuccess={back} onCancel={back} />
        </div>
      </div>
    </AppShell>
  );
}
