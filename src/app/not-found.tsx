import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-3 text-2xl font-semibold">الصفحة مش موجودة</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          الرابط ده مش موجود في لوحة الاختبار. ارجع للرئيسية وكمل من السايدبار.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">الرجوع للرئيسية</Link>
        </Button>
      </div>
    </main>
  );
}
