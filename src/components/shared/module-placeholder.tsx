import { AppShell } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

type ModulePlaceholderProps = {
  title: string;
  phase: string;
  description: string;
};

export function ModulePlaceholder({
  title,
  phase,
  description,
}: ModulePlaceholderProps) {
  return (
    <AppShell>
      <PageHeader title={title} description={description} />
      <EmptyState
        title={`${title} هتتعمل في ${phase}`}
        description="الصفحة جاهزة كبداية. الجداول، الفورمات، الفلاتر، والإجراءات هتتضاف في مرحلة التنفيذ الخاصة بيها."
      />
    </AppShell>
  );
}
