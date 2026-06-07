"use client";

import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import {
  Check, ChevronRight, ChevronLeft, Plus, Trash2,
  Building2, UtensilsCrossed, Store, ClipboardList, Images, Phone,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploader } from "@/components/shared/image-uploader";
import { adminService } from "@/services/admin";
import { branchesService, branchPhonesService } from "@/services/branches";
import { menuItemsService } from "@/services/menu";
import { categoriesService } from "@/services/categories";
import { requireSupabase } from "@/lib/supabase/client";
import { toAppError } from "@/lib/errors";
import { useLocale } from "@/lib/i18n";

// ── Draft types ───────────────────────────────────────────────────────────────

type DraftBranch = {
  _id: string;
  name_ar: string;
  name_en: string;
  address_ar: string;
  address_en: string;
  location_url: string;
  phones: string[];
};

type DraftMenuItem = {
  _id: string;
  category_id: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  image_url: string;
  price: number;
  is_available: boolean;
};

type DraftGalleryPhoto = {
  _id: string;
  image_url: string;
  description: string;
  sort_order: number;
};

// ── Schemas ───────────────────────────────────────────────────────────────────

const infoSchema = z.object({
  name_ar: z.string().min(2, "اسم المطعم بالعربية مطلوب"),
  name_en: z.string().min(2, "Restaurant name in English is required"),
  description_ar: z.string().optional(),
  description_en: z.string().optional(),
  logo_url: z.string().optional(),
  cover_url: z.string().optional(),
  delivery_fee: z.coerce.number().min(0),
  min_order_amount: z.coerce.number().min(0),
  estimated_delivery_time: z.coerce.number().min(1),
  accepts_online_orders: z.boolean(),
});

const branchSchema = z.object({
  name_ar: z.string().optional(),
  name_en: z.string().optional(),
  address_ar: z.string().min(3, "العنوان بالعربية مطلوب"),
  address_en: z.string().min(3, "Address in English is required"),
  location_url: z.string().url("رابط غير صحيح").optional().or(z.literal("")),
  phones: z.array(z.string()),
});

const menuItemSchema = z.object({
  category_id: z.string().optional(),
  name_ar: z.string().min(2, "اسم الصنف بالعربية مطلوب"),
  name_en: z.string().min(2, "Item name in English is required"),
  description_ar: z.string().optional(),
  description_en: z.string().optional(),
  image_url: z.string().optional(),
  price: z.coerce.number().min(0, "السعر مطلوب"),
  is_available: z.boolean(),
});

type InfoForm = z.infer<typeof infoSchema>;
type BranchForm = z.infer<typeof branchSchema>;
type MenuItemForm = z.infer<typeof menuItemSchema>;

const infoDefaults: InfoForm = {
  name_ar: "",
  name_en: "",
  description_ar: "",
  description_en: "",
  logo_url: "",
  cover_url: "",
  delivery_fee: 15,
  min_order_amount: 0,
  estimated_delivery_time: 30,
  accepts_online_orders: true,
};

const branchDefaults: BranchForm = {
  name_ar: "",
  name_en: "",
  address_ar: "",
  address_en: "",
  location_url: "",
  phones: [],
};

const menuItemDefaults: MenuItemForm = {
  category_id: "",
  name_ar: "",
  name_en: "",
  description_ar: "",
  description_en: "",
  image_url: "",
  price: 0,
  is_available: true,
};

// ── FormField helper ──────────────────────────────────────────────────────────

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

// ── Step Indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { icon: Store,          label: "المعلومات الأساسية" },
  { icon: Building2,      label: "الفروع" },
  { icon: UtensilsCrossed, label: "قائمة الطعام" },
  { icon: Images,         label: "معرض الصور" },
  { icon: ClipboardList,  label: "المراجعة" },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-1 border-b bg-muted/30 px-4 py-3 sm:gap-2 sm:px-6 sm:py-4">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-1 sm:gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors sm:h-9 sm:w-9 ${
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : active
                      ? "border-primary bg-background text-primary"
                      : "border-muted-foreground/30 bg-background text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className={`hidden text-xs sm:block ${active ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mb-4 h-px w-4 sm:w-10 ${i < current ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Basic Info ────────────────────────────────────────────────────────

function StepInfo({
  form,
  selectedCategoryIds,
  onCategoryToggle,
  onNext,
}: {
  form: ReturnType<typeof useForm<InfoForm>>;
  selectedCategoryIds: string[];
  onCategoryToggle: (id: string) => void;
  onNext: () => void;
}) {
  const logoUrl = form.watch("logo_url");
  const coverUrl = form.watch("cover_url");
  const locale = useLocale();

  const categoriesQuery = useQuery({
    queryKey: ["categories-list"],
    queryFn: () => categoriesService.getAll({ pageSize: 100 }),
  });
  const categories = categoriesQuery.data?.data ?? [];

  return (
    <form className="mx-auto max-w-2xl space-y-6 p-6" onSubmit={form.handleSubmit(onNext)}>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <ImageUploader
          label="صورة الغلاف (Cover)"
          type="restaurant_cover"
          value={coverUrl}
          onChange={(url) => form.setValue("cover_url", url)}
          variant="cover"
        />
        <ImageUploader
          label="الشعار (Logo)"
          type="restaurant_logo"
          value={logoUrl}
          onChange={(url) => form.setValue("logo_url", url)}
          variant="logo"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="اسم المطعم (عربي)" error={form.formState.errors.name_ar?.message}>
          <Input {...form.register("name_ar")} placeholder="مثال: مطعم الأسكندرية" autoFocus />
        </FormField>
        <FormField label="Restaurant Name (English)" error={form.formState.errors.name_en?.message}>
          <Input {...form.register("name_en")} dir="ltr" placeholder="Alexandria Restaurant" />
        </FormField>
        <FormField label="الوصف (عربي)">
          <Textarea {...form.register("description_ar")} rows={3} placeholder="أكلة شعبية مصرية بمذاق أصيل…" />
        </FormField>
        <FormField label="Description (English)">
          <Textarea {...form.register("description_en")} dir="ltr" rows={3} placeholder="Authentic Egyptian street food…" />
        </FormField>
        <FormField label="رسوم التوصيل (ج.م)" error={form.formState.errors.delivery_fee?.message}>
          <Input {...form.register("delivery_fee")} type="number" step="0.5" min="0" />
        </FormField>
        <FormField label="أدنى طلب (ج.م)">
          <Input {...form.register("min_order_amount")} type="number" step="0.5" min="0" />
        </FormField>
        <FormField label="وقت التوصيل التقديري (دقيقة)">
          <Input {...form.register("estimated_delivery_time")} type="number" min="1" />
        </FormField>
        <div className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            {...form.register("accepts_online_orders")}
            className="h-4 w-4 rounded border-gray-300"
            id="accepts-online"
          />
          <Label htmlFor="accepts-online">قبول الطلبات أونلاين</Label>
        </div>
      </div>

      {/* Categories multi-select */}
      <div className="space-y-2">
        <Label>تصنيفات المطعم (اختياري)</Label>
        {categoriesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">جاري التحميل…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد تصنيفات</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const selected = selectedCategoryIds.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onCategoryToggle(cat.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {locale === "ar" ? cat.name_ar : cat.name_en}
                </button>
              );
            })}
          </div>
        )}
        {selectedCategoryIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            تم اختيار {selectedCategoryIds.length} تصنيف
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit">
          التالي <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

// ── PhonesField (wizard inline) ───────────────────────────────────────────────

function WizardPhonesField({ form }: { form: ReturnType<typeof useForm<BranchForm>> }) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "phones" as never,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-muted-foreground" />
        <Label>أرقام الهاتف</Label>
      </div>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد أرقام</p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <Input
                {...form.register(`phones.${index}`)}
                type="tel"
                dir="ltr"
                placeholder="01xxxxxxxxx"
                className="flex-1"
              />
              <Button
                type="button"
                size="icon"
                variant="destructive"
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append("")}
      >
        <Plus className="h-4 w-4" /> إضافة رقم
      </Button>
    </div>
  );
}

// ── Step 2: Branches ──────────────────────────────────────────────────────────

function StepBranches({
  branches,
  onAdd,
  onRemove,
  onNext,
  onBack,
}: {
  branches: DraftBranch[];
  onAdd: (b: DraftBranch) => void;
  onRemove: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const locale = useLocale();
  const form = useForm<BranchForm>({ resolver: zodResolver(branchSchema), defaultValues: branchDefaults });

  function addBranch(values: BranchForm) {
    onAdd({
      _id: crypto.randomUUID(),
      name_ar: values.name_ar ?? "",
      name_en: values.name_en ?? "",
      address_ar: values.address_ar,
      address_en: values.address_en,
      location_url: values.location_url ?? "",
      phones: values.phones ?? [],
    });
    form.reset(branchDefaults);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h3 className="text-base font-semibold">إضافة الفروع</h3>
        <p className="text-sm text-muted-foreground">أضف فروع المطعم الآن أو تخطَّها وأضفها لاحقاً.</p>
      </div>

      {branches.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">الفروع المضافة ({branches.length})</p>
          {branches.map((b) => (
            <div key={b._id} className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
              <div>
                <p className="text-sm font-medium">
                  {locale === "ar" ? (b.name_ar || b.address_ar) : (b.name_en || b.address_en)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locale === "ar" ? b.address_ar : b.address_en}
                </p>
                {b.phones.length > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {b.phones.filter(Boolean).length} رقم هاتف
                  </p>
                )}
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => onRemove(b._id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border bg-background p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Plus className="h-4 w-4" /> فرع جديد
        </p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit(addBranch)}>
          <FormField label="اسم الفرع (عربي)">
            <Input {...form.register("name_ar")} placeholder="الفرع الرئيسي" />
          </FormField>
          <FormField label="Branch Name (English)">
            <Input {...form.register("name_en")} dir="ltr" placeholder="Main Branch" />
          </FormField>
          <FormField label="العنوان (عربي)" error={form.formState.errors.address_ar?.message}>
            <Input {...form.register("address_ar")} placeholder="شارع كذا، المدينة" />
          </FormField>
          <FormField label="Address (English)" error={form.formState.errors.address_en?.message}>
            <Input {...form.register("address_en")} dir="ltr" placeholder="Street, City" />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="رابط الخريطة (اختياري)" error={form.formState.errors.location_url?.message}>
              <Input {...form.register("location_url")} dir="ltr" placeholder="https://maps.google.com/..." />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <WizardPhonesField form={form} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" size="sm">
              <Plus className="h-4 w-4" /> إضافة الفرع للقائمة
            </Button>
          </div>
        </form>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronRight className="h-4 w-4" /> السابق
        </Button>
        <Button type="button" onClick={onNext}>
          التالي <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Menu Items ────────────────────────────────────────────────────────

function StepMenu({
  items,
  onAdd,
  onRemove,
  onNext,
  onBack,
}: {
  items: DraftMenuItem[];
  onAdd: (item: DraftMenuItem) => void;
  onRemove: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const locale = useLocale();
  const categoriesQuery = useQuery({
    queryKey: ["categories-list"],
    queryFn: () => categoriesService.getAll({ pageSize: 100 }),
  });
  const categories = categoriesQuery.data?.data ?? [];

  const form = useForm<MenuItemForm>({ resolver: zodResolver(menuItemSchema), defaultValues: menuItemDefaults });
  const imageUrl = form.watch("image_url");

  const getCategoryName = (id: string) => {
    const c = categories.find((c) => c.id === id);
    return c ? (locale === "ar" ? c.name_ar : c.name_en) : null;
  };

  function addItem(values: MenuItemForm) {
    onAdd({
      _id: crypto.randomUUID(),
      category_id: values.category_id ?? "",
      name_ar: values.name_ar,
      name_en: values.name_en,
      description_ar: values.description_ar ?? "",
      description_en: values.description_en ?? "",
      image_url: values.image_url ?? "",
      price: values.price,
      is_available: values.is_available,
    });
    form.reset(menuItemDefaults);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h3 className="text-base font-semibold">قائمة الطعام</h3>
        <p className="text-sm text-muted-foreground">أضف أصناف قائمة الطعام الآن أو تخطَّها وأضفها لاحقاً.</p>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">الأصناف المضافة ({items.length})</p>
          {items.map((item) => (
            <div key={item._id} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              {item.image_url ? (
                <img src={item.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">🍴</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {locale === "ar" ? item.name_ar : item.name_en}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-semibold text-orange-600">{item.price} ج.م</span>
                  {item.category_id ? (
                    <Badge variant="outline" className="text-xs">{getCategoryName(item.category_id)}</Badge>
                  ) : null}
                </div>
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => onRemove(item._id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border bg-background p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Plus className="h-4 w-4" /> صنف جديد
        </p>
        <form className="space-y-3" onSubmit={form.handleSubmit(addItem)}>
          <div className="flex justify-start">
            <ImageUploader
              label="صورة الصنف"
              type="menu_item"
              value={imageUrl}
              onChange={(url) => form.setValue("image_url", url)}
              variant="square"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="اسم الصنف (عربي)" error={form.formState.errors.name_ar?.message}>
              <Input {...form.register("name_ar")} placeholder="برجر كلاسيك" />
            </FormField>
            <FormField label="Item Name (English)" error={form.formState.errors.name_en?.message}>
              <Input {...form.register("name_en")} dir="ltr" placeholder="Classic Burger" />
            </FormField>
            <FormField label="الوصف (عربي)">
              <Textarea {...form.register("description_ar")} rows={2} />
            </FormField>
            <FormField label="Description (English)">
              <Textarea {...form.register("description_en")} dir="ltr" rows={2} />
            </FormField>
            <FormField label="السعر (ج.م)" error={form.formState.errors.price?.message}>
              <Input {...form.register("price")} type="number" step="0.5" min="0" />
            </FormField>
            <FormField label="التصنيف (اختياري)">
              <Select
                value={form.watch("category_id") ?? ""}
                onValueChange={(v) => form.setValue("category_id", v === "none" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="اختر تصنيفاً" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون تصنيف</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name_ar} / {c.name_en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" {...form.register("is_available")} className="h-4 w-4 rounded border-gray-300" id="item-avail" />
              <Label htmlFor="item-avail">متاح للطلب</Label>
            </div>
          </div>
          <Button type="submit" variant="outline" size="sm">
            <Plus className="h-4 w-4" /> إضافة الصنف للقائمة
          </Button>
        </form>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronRight className="h-4 w-4" /> السابق
        </Button>
        <Button type="button" onClick={onNext}>
          التالي <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Gallery ───────────────────────────────────────────────────────────

function StepGallery({
  photos,
  onAdd,
  onRemove,
  onUpdateDescription,
  onNext,
  onBack,
}: {
  photos: DraftGalleryPhoto[];
  onAdd: (p: DraftGalleryPhoto) => void;
  onRemove: (id: string) => void;
  onUpdateDescription: (id: string, desc: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  // Single pending slot for the next photo being uploaded
  const [pendingUrl, setPendingUrl] = useState("");
  const [pendingDesc, setPendingDesc] = useState("");

  function commitPhoto() {
    if (!pendingUrl) return;
    onAdd({
      _id: crypto.randomUUID(),
      image_url: pendingUrl,
      description: pendingDesc,
      sort_order: photos.length,
    });
    setPendingUrl("");
    setPendingDesc("");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h3 className="text-base font-semibold">معرض الصور</h3>
        <p className="text-sm text-muted-foreground">
          أضف صور المطعم والأجواء التي تظهر في تطبيق الموبايل. يمكنك التخطي وإضافتها لاحقاً.
        </p>
      </div>

      {/* Current photos grid */}
      {photos.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">الصور المضافة ({photos.length})</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p, i) => (
              <div key={p._id} className="group relative overflow-hidden rounded-xl border">
                <img src={p.image_url} alt="" className="h-32 w-full object-cover" />
                {/* Sort badge */}
                <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  #{i + 1}
                </span>
                {/* Delete */}
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => onRemove(p._id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                {/* Description input */}
                <div className="p-2">
                  <input
                    className="w-full rounded border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none"
                    placeholder="وصف الصورة (اختياري)"
                    value={p.description}
                    onChange={(e) => onUpdateDescription(p._id, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add next photo */}
      <div className="rounded-lg border bg-background p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Plus className="h-4 w-4" /> إضافة صورة
        </p>
        <div className="space-y-3">
          <ImageUploader
            label="اختر صورة"
            type="gallery"
            value={pendingUrl}
            onChange={setPendingUrl}
            variant="cover"
          />
          {pendingUrl && (
            <>
              <FormField label="وصف الصورة (اختياري)">
                <Input
                  value={pendingDesc}
                  onChange={(e) => setPendingDesc(e.target.value)}
                  placeholder="مثال: أجواء المطعم من الداخل"
                />
              </FormField>
              <Button type="button" variant="outline" size="sm" onClick={commitPhoto}>
                <Plus className="h-4 w-4" /> إضافة الصورة للمعرض
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronRight className="h-4 w-4" /> السابق
        </Button>
        <Button type="button" onClick={onNext}>
          التالي <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 5: Review & Create ───────────────────────────────────────────────────

function StepReview({
  info,
  branches,
  items,
  photos,
  selectedCategoryIds,
  onBack,
  onSubmit,
  isSubmitting,
}: {
  info: InfoForm;
  branches: DraftBranch[];
  items: DraftMenuItem[];
  photos: DraftGalleryPhoto[];
  selectedCategoryIds: string[];
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const locale = useLocale();
  const categoriesQuery = useQuery({
    queryKey: ["categories-list"],
    queryFn: () => categoriesService.getAll({ pageSize: 100 }),
  });
  const allCategories = categoriesQuery.data?.data ?? [];
  const selectedCategories = allCategories.filter((c) => selectedCategoryIds.includes(c.id));

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h3 className="text-base font-semibold">المراجعة والإنشاء</h3>
        <p className="text-sm text-muted-foreground">راجع جميع البيانات قبل إنشاء المطعم.</p>
      </div>

      {/* Restaurant card */}
      <div className="overflow-hidden rounded-xl border">
        {info.cover_url ? (
          <img src={info.cover_url} alt="cover" className="h-28 w-full object-cover" />
        ) : (
          <div className="h-28 w-full bg-gradient-to-br from-orange-100 to-amber-200" />
        )}
        <div className="flex items-start gap-4 p-4">
          {info.logo_url ? (
            <img src={info.logo_url} alt="logo" className="h-14 w-14 -mt-8 shrink-0 rounded-xl border-4 border-background object-cover" />
          ) : (
            <div className="flex h-14 w-14 -mt-8 shrink-0 items-center justify-center rounded-xl border-4 border-background bg-muted text-2xl">🏪</div>
          )}
          <div>
            <p className="font-bold">{locale === "ar" ? info.name_ar : info.name_en}</p>
            <p className="text-xs text-muted-foreground">{locale === "ar" ? info.name_en : info.name_ar}</p>
            {info.description_ar ? (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{info.description_ar}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{info.delivery_fee} ج.م توصيل</Badge>
              <Badge variant="outline">{info.estimated_delivery_time} دقيقة</Badge>
              <Badge variant="outline">أدنى {info.min_order_amount} ج.م</Badge>
              {info.accepts_online_orders ? <Badge>أونلاين</Badge> : null}
            </div>
          </div>
        </div>
      </div>

      {/* Categories */}
      {selectedCategories.length > 0 && (
        <div className="rounded-xl border p-4">
          <p className="mb-2 text-sm font-semibold">التصنيفات ({selectedCategories.length})</p>
          <div className="flex flex-wrap gap-2">
            {selectedCategories.map((c) => (
              <Badge key={c.id} variant="secondary">
                {locale === "ar" ? c.name_ar : c.name_en}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Branches */}
      <div className="rounded-xl border p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4" /> الفروع ({branches.length})
        </p>
        {branches.length === 0 ? (
          <p className="text-sm text-muted-foreground">لم تُضف أي فروع — يمكنك إضافتها لاحقاً.</p>
        ) : (
          <div className="space-y-1">
            {branches.map((b) => (
              <div key={b._id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {locale === "ar" ? (b.name_ar || b.address_ar) : (b.name_en || b.address_en)}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">
                  {locale === "ar" ? b.address_ar : b.address_en}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Menu items */}
      <div className="rounded-xl border p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <UtensilsCrossed className="h-4 w-4" /> قائمة الطعام ({items.length} صنف)
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">لم تُضف أي أصناف — يمكنك إضافتها لاحقاً.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <div key={item._id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-sm">🍴</div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {locale === "ar" ? item.name_ar : item.name_en}
                  </p>
                  <p className="text-xs text-orange-600">{item.price} ج.م</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gallery */}
      <div className="rounded-xl border p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Images className="h-4 w-4" /> معرض الصور ({photos.length} صورة)
        </p>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">لم تُضف أي صور — يمكنك إضافتها لاحقاً.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p) => (
              <img key={p._id} src={p.image_url} alt={p.description} className="h-16 w-full rounded-lg object-cover" />
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          <ChevronRight className="h-4 w-4" /> السابق
        </Button>
        <Button type="button" onClick={onSubmit} disabled={isSubmitting} className="min-w-36">
          {isSubmitting ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              جاري الإنشاء…
            </>
          ) : (
            <>
              <Check className="h-4 w-4" /> إنشاء المطعم
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Wizard Root ───────────────────────────────────────────────────────────────

type AddRestaurantWizardProps = {
  onSuccess: () => void;
  onCancel: () => void;
};

export function AddRestaurantWizard({ onSuccess, onCancel }: AddRestaurantWizardProps) {
  const [step, setStep] = useState(0);
  const [branches, setBranches] = useState<DraftBranch[]>([]);
  const [menuItems, setMenuItems] = useState<DraftMenuItem[]>([]);
  const [galleryPhotos, setGalleryPhotos] = useState<DraftGalleryPhoto[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleCategory(id: string) {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  const infoForm = useForm<InfoForm>({
    resolver: zodResolver(infoSchema),
    defaultValues: infoDefaults,
  });

  async function handleCreate() {
    const infoData = infoForm.getValues();
    setIsSubmitting(true);
    try {
      // 1. Create restaurant
      const result = (await adminService.createRestaurant({
        nameAr: infoData.name_ar,
        nameEn: infoData.name_en,
        descriptionAr: infoData.description_ar || undefined,
        descriptionEn: infoData.description_en || undefined,
        logoUrl: infoData.logo_url || undefined,
        coverUrl: infoData.cover_url || undefined,
        deliveryFee: infoData.delivery_fee,
        minOrderAmount: infoData.min_order_amount,
        acceptsOnline: infoData.accepts_online_orders,
        categoryIds: selectedCategoryIds.length > 0 ? selectedCategoryIds : undefined,
      })) as { id?: string } | null;

      const restaurantId = (result as { id?: string } | null)?.id;
      if (!restaurantId) throw new Error("فشل في الحصول على معرّف المطعم");

      const supabase = requireSupabase();
      const errors: string[] = [];

      // 2. Branches
      for (const b of branches) {
        try {
          const branchResult = await branchesService.create({
            restaurant_id: restaurantId,
            name_ar: b.name_ar || null,
            name_en: b.name_en || null,
            address_ar: b.address_ar,
            address_en: b.address_en,
            location_url: b.location_url || null,
          });
          const branchId = branchResult.data.id;
          const filteredPhones = b.phones.filter(Boolean);
          if (filteredPhones.length > 0) {
            await branchPhonesService.syncPhones(branchId, filteredPhones);
          }
        } catch {
          errors.push(`فرع: ${b.name_ar || b.address_ar}`);
        }
      }

      // 3. Menu items
      for (const item of menuItems) {
        try {
          await menuItemsService.create({
            restaurant_id: restaurantId,
            category_id: item.category_id || null,
            name_ar: item.name_ar,
            name_en: item.name_en,
            description_ar: item.description_ar || null,
            description_en: item.description_en || null,
            image_url: item.image_url || null,
            price: item.price,
            is_available: item.is_available,
          });
        } catch {
          errors.push(`صنف: ${item.name_ar}`);
        }
      }

      // 4. Gallery photos
      for (const photo of galleryPhotos) {
        try {
          const { error } = await supabase
            .from("restaurant_gallery")
            .insert({
              restaurant_id: restaurantId,
              image_url: photo.image_url,
              description: photo.description || null,
              sort_order: photo.sort_order,
            });
          if (error) throw error;
        } catch {
          errors.push(`صورة معرض`);
        }
      }

      if (errors.length > 0) {
        toast.warning(`تم إنشاء المطعم لكن فشل بعض العناصر: ${errors.join(" | ")}`);
      } else {
        toast.success("تم إنشاء المطعم بالكامل بنجاح 🎉");
      }

      onSuccess();
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <StepIndicator current={step} />
      <div className="flex-1 overflow-y-auto">
        {step === 0 && (
          <StepInfo
            form={infoForm}
            selectedCategoryIds={selectedCategoryIds}
            onCategoryToggle={toggleCategory}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <StepBranches
            branches={branches}
            onAdd={(b) => setBranches((p) => [...p, b])}
            onRemove={(id) => setBranches((p) => p.filter((b) => b._id !== id))}
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && (
          <StepMenu
            items={menuItems}
            onAdd={(item) => setMenuItems((p) => [...p, item])}
            onRemove={(id) => setMenuItems((p) => p.filter((m) => m._id !== id))}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <StepGallery
            photos={galleryPhotos}
            onAdd={(p) => setGalleryPhotos((prev) => [...prev, p])}
            onRemove={(id) => setGalleryPhotos((p) => p.filter((g) => g._id !== id))}
            onUpdateDescription={(id, desc) =>
              setGalleryPhotos((p) => p.map((g) => (g._id === id ? { ...g, description: desc } : g)))
            }
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <StepReview
            info={infoForm.getValues()}
            branches={branches}
            items={menuItems}
            photos={galleryPhotos}
            selectedCategoryIds={selectedCategoryIds}
            onBack={() => setStep(3)}
            onSubmit={handleCreate}
            isSubmitting={isSubmitting}
          />
        )}
      </div>
    </div>
  );
}
