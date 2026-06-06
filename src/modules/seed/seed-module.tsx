"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";
import { adminService } from "@/services/admin";
import { requireSupabase } from "@/lib/supabase/client";

type SeedStep = {
  id: string;
  label: string;
  description: string;
  run: () => Promise<string>;
};

function useSeedMutation(step: SeedStep) {
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const mutation = useMutation({
    mutationFn: step.run,
    onSuccess: (msg) => {
      toast.success(msg);
      setDone(true);
      void queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });
  return { mutation, done };
}

async function seedCategories(): Promise<string> {
  const cats = [
    { nameAr: "برجر", nameEn: "Burger" },
    { nameAr: "بيتزا", nameEn: "Pizza" },
    { nameAr: "مأكولات بحرية", nameEn: "Seafood" },
    { nameAr: "مشويات", nameEn: "Grills" },
    { nameAr: "مشروبات", nameEn: "Beverages" },
  ];
  for (const [i, c] of cats.entries()) {
    await adminService.manageCategory({
      action: "create",
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      sortOrder: i + 1,
      isActive: true,
    });
  }
  return `تم إنشاء ${cats.length} تصنيفات`;
}

async function seedRestaurant(): Promise<string> {
  const result = await adminService.createRestaurant({
    nameAr: "مطعم النيل",
    nameEn: "Nile Restaurant",
    descriptionAr: "مطعم تجريبي لاختبار النظام",
    descriptionEn: "Test restaurant for system testing",
    deliveryFee: 15,
    minOrderAmount: 50,
    acceptsOnline: true,
  });
  if (result?.error) throw new Error(result.error);
  return `تم إنشاء مطعم: ${result?.name_ar ?? "النيل"}`;
}

async function seedBranch(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = requireSupabase() as any;
  const { data: rests } = await supabase.from("restaurants").select("id").limit(1);
  if (!rests?.length) throw new Error("أنشئ مطعماً أولاً");
  const { error } = await supabase.from("branches").insert({
    restaurant_id: rests[0].id,
    name_ar: "الفرع الرئيسي",
    name_en: "Main Branch",
    address_ar: "شارع الجمهورية، كفر الدوار",
    address_en: "El Gomhoria St, Kafr El-Dawwar",
  });
  if (error) throw error;
  return "تم إنشاء الفرع الرئيسي";
}

async function seedMenuItems(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = requireSupabase() as any;
  const [{ data: rests }, { data: cats }] = await Promise.all([
    supabase.from("restaurants").select("id").limit(1),
    supabase.from("categories").select("id").limit(1),
  ]);
  if (!rests?.length) throw new Error("أنشئ مطعماً أولاً");
  const restaurantId = rests[0].id;
  const categoryId = cats?.[0]?.id ?? null;
  const items = [
    { name_ar: "برجر كلاسيك", name_en: "Classic Burger", price: 85 },
    { name_ar: "بيتزا مارجريتا", name_en: "Margherita Pizza", price: 120 },
    { name_ar: "شيش طاووق", name_en: "Shish Tawook", price: 95 },
    { name_ar: "عصير مانجو", name_en: "Mango Juice", price: 35 },
  ];
  const { error } = await supabase.from("menu_items").insert(
    items.map((it: object) => ({ ...it, restaurant_id: restaurantId, category_id: categoryId, is_available: true }))
  );
  if (error) throw error;
  return `تم إنشاء ${items.length} عناصر منيو`;
}

async function seedVoucher(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = requireSupabase() as any;
  const { data: rests } = await supabase.from("restaurants").select("id").limit(1);
  if (!rests?.length) throw new Error("أنشئ مطعماً أولاً");
  const { error } = await supabase.from("vouchers").insert({
    restaurant_id: rests[0].id,
    code: "TEST20",
    discount_type: "percentage",
    discount_value: 20,
    min_order_amount: 50,
    valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    is_active: true,
  });
  if (error && !error.message.includes("duplicate")) throw error;
  return "تم إنشاء كود خصم: TEST20 (20%)";
}

async function seedOffer(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = requireSupabase() as any;
  const { data: rests } = await supabase.from("restaurants").select("id").limit(1);
  if (!rests?.length) throw new Error("أنشئ مطعماً أولاً");
  const { error } = await supabase.from("offers").insert({
    restaurant_id: rests[0].id,
    title_ar: "عرض الأسبوع",
    title_en: "Weekly Deal",
    discount_percentage: 15,
    is_active: true,
    end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  return "تم إنشاء عرض: عرض الأسبوع (15%)";
}

function SeedCard({
  step,
  order,
}: {
  step: SeedStep;
  order: number;
}) {
  const { mutation, done } = useSeedMutation(step);

  return (
    <Card className={done ? "border-green-300" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
              {order}
            </span>
            {step.label}
          </CardTitle>
          {done && <Badge variant="default" className="gap-1 text-xs"><CheckCircle className="h-3 w-3" /> تم</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{step.description}</p>
      </CardHeader>
      <CardContent>
        <Button
          size="sm"
          variant={done ? "secondary" : "default"}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> جاري…</>
          ) : done ? (
            "تشغيل مرة أخرى"
          ) : (
            "تشغيل"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export function SeedModule() {
  const steps: SeedStep[] = [
    {
      id: "categories",
      label: "تصنيفات",
      description: "ينشئ 5 تصنيفات أساسية (برجر، بيتزا، مشويات…)",
      run: seedCategories,
    },
    {
      id: "restaurant",
      label: "مطعم تجريبي",
      description: "ينشئ مطعم النيل كمطعم اختبار",
      run: seedRestaurant,
    },
    {
      id: "branch",
      label: "فرع رئيسي",
      description: "ينشئ الفرع الرئيسي للمطعم (يحتاج مطعماً أولاً)",
      run: seedBranch,
    },
    {
      id: "menu-items",
      label: "عناصر المنيو",
      description: "ينشئ 4 عناصر منيو للمطعم الأول",
      run: seedMenuItems,
    },
    {
      id: "voucher",
      label: "كود خصم",
      description: "ينشئ كود TEST20 بخصم 20%",
      run: seedVoucher,
    },
    {
      id: "offer",
      label: "عرض",
      description: "ينشئ عرض أسبوعي بخصم 15%",
      run: seedOffer,
    },
  ];

  return (
    <>
      <PageHeader
        title="بيانات تجريبية"
        description="أنشئ بيانات اختبار لتجربة كل وظائف النظام. شغّل الخطوات بالترتيب."
      />

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <strong>ملاحظة:</strong> هذه البيانات حقيقية وتُحفظ في قاعدة البيانات. لمسح البيانات التجريبية استخدم Supabase Dashboard.
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => (
          <SeedCard key={step.id} step={step} order={i + 1} />
        ))}
      </div>

      <div className="mt-6 rounded-lg border bg-muted/30 p-4 text-sm">
        <div className="flex items-center gap-2 mb-2 font-semibold">
          <Database className="h-4 w-4" />
          لإنشاء مستخدم تجريبي
        </div>
        <p className="text-muted-foreground text-xs">
          اذهب إلى <a href="/users" className="underline">صفحة المستخدمين</a> واستخدم نموذج "إنشاء مستخدم تجريبي".
          بعدها يمكنك ربط المستخدم بمطعم من صفحة المطاعم.
        </p>
      </div>
    </>
  );
}
