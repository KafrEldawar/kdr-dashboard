import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { DeliveryConfigForm } from "@/modules/settings/delivery-config-form";

export default function DeliverySettingsPage() {
  return (
    <AppShell>
      <PageHeader
        title="إعدادات التوصيل"
        description="معادلة احتساب رسوم التوصيل بناءً على المسافة. التغييرات تنطبق فوراً على الطلبات الجديدة."
      />
      <DeliveryConfigForm />
    </AppShell>
  );
}
