import { AppShell } from "@/components/layout/app-shell";
import { ReviewsModule } from "@/modules/reviews/reviews-module";

export default function ReviewsPage() {
  return (
    <AppShell>
      <ReviewsModule />
    </AppShell>
  );
}
