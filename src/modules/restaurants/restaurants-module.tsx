"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Edit, Eye, ToggleRight, Trash2, Plus, Star, MapPin,
  Clock, ShoppingBag, Building2, Tag, Images,
  Gift, MessageSquare, ExternalLink, Utensils, X, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { FullScreenDialog } from "@/components/shared/full-screen-dialog";
import { ImageUploader } from "@/components/shared/image-uploader";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService } from "@/services/admin";
import { restaurantsService, restaurantCategoriesService } from "@/services/restaurants";
import { categoriesService } from "@/services/categories";
import { branchesService } from "@/services/branches";
import { menuItemsService } from "@/services/menu";
import { offersService } from "@/services/offers";
import { requireSupabase } from "@/lib/supabase/client";
import { useTranslations, useLocale } from "@/lib/i18n";
import type { Branch, Category, MenuItem, Offer, Restaurant, RestaurantGallery } from "@/types/database";

const schema = z.object({
  name_ar: z.string().min(2, "اسم المطعم بالعربية مطلوب"),
  name_en: z.string().min(2, "Restaurant name in English is required"),
  description_ar: z.string().optional(),
  description_en: z.string().optional(),
  logo_url: z.string().optional(),
  cover_url: z.string().optional(),
  commission_percentage: z.coerce.number().min(0).max(100).optional(),
  estimated_delivery_time: z.coerce.number().min(1).optional(),
  accepts_online_orders: z.boolean().default(true).optional(),
  // Admin-controlled per-restaurant permission — gates the "قبول
  // وتوصيل بنفسي" button on the owner mobile app.
  self_delivery_enabled: z.boolean().default(false).optional(),
  category_ids: z.array(z.string()),
});

type RestaurantForm = z.infer<typeof schema>;

const defaultValues: RestaurantForm = {
  name_ar: "",
  name_en: "",
  description_ar: "",
  description_en: "",
  logo_url: "",
  cover_url: "",
  commission_percentage: 10,
  estimated_delivery_time: 30,
  accepts_online_orders: true,
  self_delivery_enabled: false,
  category_ids: [],
};

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

function CategoriesField({
  form,
  allCategories,
}: {
  form: ReturnType<typeof useForm<RestaurantForm>>;
  allCategories: Category[];
}) {
  const selected = form.watch("category_ids");

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((s) => s !== id)
      : [...selected, id];
    form.setValue("category_ids", next, { shouldDirty: true });
  }

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground" />
        التصنيفات
      </Label>
      {allCategories.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد تصنيفات</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allCategories.map((cat) => {
            const isOn = selected.includes(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => toggle(cat.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  isOn
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                {cat.image_url ? (
                  <img src={cat.image_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                ) : null}
                {cat.name_ar}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GalleryManager({ restaurantId }: { restaurantId: string }) {
  const queryClient = useQueryClient();
  const [pendingUrl, setPendingUrl] = useState("");
  const [pendingDesc, setPendingDesc] = useState("");
  const [addingPhoto, setAddingPhoto] = useState(false);

  const galleryQuery = useQuery({
    queryKey: ["restaurant-gallery", restaurantId],
    queryFn: async () => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("restaurant_gallery")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RestaurantGallery[];
    },
  });

  const photos = galleryQuery.data ?? [];

  async function addPhoto() {
    if (!pendingUrl) return;
    setAddingPhoto(true);
    try {
      const supabase = requireSupabase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("restaurant_gallery").insert({
        restaurant_id: restaurantId,
        image_url: pendingUrl,
        description: pendingDesc || null,
        sort_order: photos.length,
      });
      if (error) throw error;
      setPendingUrl("");
      setPendingDesc("");
      void queryClient.invalidateQueries({ queryKey: ["restaurant-gallery", restaurantId] });
      toast.success("تمت إضافة الصورة");
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setAddingPhoto(false);
    }
  }

  async function deletePhoto(id: string) {
    try {
      const supabase = requireSupabase();
      const { error } = await supabase.from("restaurant_gallery").delete().eq("id", id);
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: ["restaurant-gallery", restaurantId] });
      toast.success("تم حذف الصورة");
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  }

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2">
        <Images className="h-4 w-4" />
        معرض الصور
      </Label>

      {/* Existing photos */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-xl border">
              <img src={p.image_url} alt={p.description ?? ""} className="h-28 w-full object-cover" />
              {p.description ? (
                <div className="bg-muted/80 px-2 py-1">
                  <p className="truncate text-xs text-muted-foreground">{p.description}</p>
                </div>
              ) : null}
              <button
                type="button"
                className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => void deletePhoto(p.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new photo */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">إضافة صورة جديدة</p>
        <ImageUploader
          type="gallery"
          value={pendingUrl}
          onChange={setPendingUrl}
          variant="cover"
        />
        {pendingUrl && (
          <div className="mt-2 space-y-2">
            <Input
              value={pendingDesc}
              onChange={(e) => setPendingDesc(e.target.value)}
              placeholder="وصف الصورة (اختياري)"
              className="text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void addPhoto()}
              disabled={addingPhoto}
            >
              <Plus className="h-4 w-4" />
              {addingPhoto ? "جاري الإضافة…" : "إضافة للمعرض"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RestaurantFormFields({
  form,
  onSubmit,
  isPending,
  submitLabel,
  onCancel,
  restaurantId,
  allCategories,
}: {
  form: ReturnType<typeof useForm<RestaurantForm>>;
  onSubmit: (v: RestaurantForm) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
  restaurantId?: string;
  allCategories: Category[];
}) {
  const logoUrl = form.watch("logo_url");
  const coverUrl = form.watch("cover_url");

  return (
    <form
      className="mx-auto max-w-2xl space-y-6 p-6"
      onSubmit={form.handleSubmit(onSubmit)}
    >
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
          <Input {...form.register("name_ar")} placeholder="مثال: مطعم الأسكندرية" />
        </FormField>
        <FormField label="Restaurant Name (English)" error={form.formState.errors.name_en?.message}>
          <Input {...form.register("name_en")} dir="ltr" placeholder="Alexandria Restaurant" />
        </FormField>
        <FormField label="الوصف (عربي)">
          <Textarea {...form.register("description_ar")} rows={3} />
        </FormField>
        <FormField label="Description (English)">
          <Textarea {...form.register("description_en")} dir="ltr" rows={3} />
        </FormField>
        <FormField label="نسبة عمولة المنصة (%)" error={form.formState.errors.commission_percentage?.message}>
          <Input {...form.register("commission_percentage")} type="number" step="0.5" min="0" max="100" />
        </FormField>
        <FormField label="وقت التوصيل (دقيقة)">
          <Input {...form.register("estimated_delivery_time")} type="number" />
        </FormField>
        <div className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            {...form.register("accepts_online_orders")}
            className="h-4 w-4 rounded border-gray-300"
          />
          <Label>قبول الطلبات أونلاين</Label>
        </div>
        <div className="flex items-start gap-2 pt-6 sm:col-span-2">
          <input
            type="checkbox"
            id="self-delivery-enabled"
            {...form.register("self_delivery_enabled")}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <div className="min-w-0">
            <Label htmlFor="self-delivery-enabled">
              السماح للمطعم بالتوصيل بنفسه
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              لما تفعّلها، هيظهر للمطعم زر «قبول وتوصيل بنفسي» على تطبيق الأونر، والطلب مش هيروح لسائقي المنصة.
            </p>
          </div>
        </div>
      </div>

      <CategoriesField form={form} allCategories={allCategories} />

      {/* Gallery — only shown in edit mode (we have a restaurantId) */}
      {restaurantId ? (
        <GalleryManager restaurantId={restaurantId} />
      ) : null}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "جاري الحفظ…" : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}

function DetailSection({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: typeof Star;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 card-elevated">
      <h3 className="mb-4 flex items-center gap-2 text-base font-bold">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        {title}
        {typeof count === "number" ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {count}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

function StarsRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i < rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}
        />
      ))}
    </div>
  );
}

function RestaurantDetailView({ restaurant }: { restaurant: Restaurant }) {
  const locale = useLocale();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["restaurant-branches", restaurant.id],
    queryFn: () => branchesService.filters({ restaurant_id: restaurant.id }, { pageSize: 50 }),
  });
  const menuQuery = useQuery({
    queryKey: ["restaurant-menu", restaurant.id],
    queryFn: () => menuItemsService.filters({ restaurant_id: restaurant.id }, { pageSize: 200 }),
  });
  const offersQuery = useQuery({
    queryKey: ["restaurant-offers", restaurant.id],
    queryFn: () => offersService.filters({ restaurant_id: restaurant.id }, { pageSize: 50 }),
  });
  const ratingsQuery = useQuery({
    queryKey: ["restaurant-ratings", restaurant.id],
    queryFn: () => adminService.getRatings({ restaurantId: restaurant.id, pageSize: 50 }),
  });
  const galleryQuery = useQuery({
    queryKey: ["restaurant-gallery", restaurant.id],
    queryFn: async () => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("restaurant_gallery")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RestaurantGallery[];
    },
  });

  const name = (locale === "ar" ? restaurant.name_ar : restaurant.name_en) || restaurant.name_ar;
  const description = locale === "ar" ? restaurant.description_ar : restaurant.description_en;
  const branches: Branch[] = branchesQuery.data?.data ?? [];
  const menuItems: MenuItem[] = menuQuery.data?.data ?? [];
  const offers: Offer[] = offersQuery.data?.data ?? [];
  const gallery: RestaurantGallery[] = galleryQuery.data ?? [];
  const ratings = ratingsQuery.data?.data ?? [];
  const ratingsCount = ratingsQuery.data?.meta?.total ?? ratings.length;
  const avgRating = ratings.length
    ? ratings.reduce((s, r) => s + (r.rating ?? 0), 0) / ratings.length
    : 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card card-elevated">
        <div className="relative h-44 bg-muted sm:h-56">
          {restaurant.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={restaurant.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="dot-grid flex h-full items-center justify-center text-muted-foreground">
              <Building2 className="h-10 w-10 opacity-40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
          <div className="absolute bottom-4 end-5 flex items-end gap-3">
            <span className="h-20 w-20 overflow-hidden rounded-2xl border-4 border-card bg-card shadow-lg">
              {restaurant.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={restaurant.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                  <Building2 className="h-8 w-8" />
                </span>
              )}
            </span>
          </div>
          <div className="absolute start-5 top-4">
            <Badge variant={restaurant.is_active ? "success" : "secondary"}>
              {restaurant.is_active ? "مفعّل" : "متوقف"}
            </Badge>
          </div>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-2xl font-extrabold tracking-tight">{name}</h2>
              {description ? (
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-2">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              <span className="text-lg font-extrabold tabular-nums">{avgRating.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({ratingsCount})</span>
            </div>
          </div>

          {/* Chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              <ShoppingBag className="h-3.5 w-3.5" /> عمولة {restaurant.commission_percentage}%
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--chart-4)/0.12)] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--chart-4))]">
              <Clock className="h-3.5 w-3.5" /> {restaurant.estimated_delivery_time} دقيقة
            </span>
            <span
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                restaurant.accepts_online_orders
                  ? "bg-success/12 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {restaurant.accepts_online_orders ? "يقبل الطلبات أونلاين" : "أونلاين متوقف"}
            </span>
          </div>

          {/* Stat strip */}
          <div className="mt-4 grid grid-cols-4 gap-3 rounded-xl bg-muted/40 p-3 text-center">
            <Stat label="فرع" value={branches.length} icon={Building2} />
            <Stat label="صنف" value={menuItems.length} icon={Utensils} />
            <Stat label="صورة" value={gallery.length} icon={Images} />
            <Stat label="تقييم" value={ratingsCount} icon={Star} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Menu */}
          <DetailSection title="قائمة الطعام" icon={Utensils} count={menuItems.length}>
            {menuItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد أصناف.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {menuItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Utensils className="h-5 w-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">
                          {locale === "ar" ? item.name_ar : item.name_en ?? item.name_ar}
                        </p>
                        {!item.is_available ? (
                          <Badge variant="secondary" className="shrink-0">غير متاح</Badge>
                        ) : null}
                      </div>
                      {item.description_ar ? (
                        <p className="truncate text-xs text-muted-foreground">{item.description_ar}</p>
                      ) : null}
                      <p className="mt-0.5 text-sm font-bold text-primary">{item.price} ج.م</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailSection>

          {/* Reviews */}
          <DetailSection title="التقييمات" icon={MessageSquare} count={ratingsCount}>
            {ratings.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد تقييمات بعد.</p>
            ) : (
              <div className="space-y-2.5">
                {ratings.map((r) => (
                  <div key={r.order_id} className="rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StarsRow rating={r.rating} />
                        <span className="text-sm font-semibold">{r.user_name?.trim() || "مستخدم"}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatDate(r.created_at, locale)}</span>
                    </div>
                    {r.review?.trim() ? (
                      <p className="mt-1.5 text-sm text-muted-foreground">{r.review}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </DetailSection>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          {/* Offers */}
          <DetailSection title="العروض" icon={Gift} count={offers.length}>
            {offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد عروض.</p>
            ) : (
              <div className="space-y-2">
                {offers.map((offer) => (
                  <div key={offer.id} className="flex items-center gap-2.5 rounded-xl border border-border p-2.5">
                    {offer.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={offer.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Gift className="h-5 w-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {locale === "ar" ? offer.title_ar : offer.title_en ?? offer.title_ar}
                      </p>
                      <p className="text-xs text-muted-foreground">خصم {offer.discount_percentage}%</p>
                    </div>
                    <Badge variant={offer.is_active ? "success" : "secondary"} className="shrink-0">
                      {offer.is_active ? "فعّال" : "منتهي"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </DetailSection>

          {/* Branches */}
          <DetailSection title="الفروع" icon={MapPin} count={branches.length}>
            {branches.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد فروع.</p>
            ) : (
              <div className="space-y-2">
                {branches.map((branch) => (
                  <div key={branch.id} className="rounded-xl border border-border p-3">
                    <p className="text-sm font-semibold">
                      {locale === "ar"
                        ? branch.name_ar ?? branch.address_ar
                        : branch.name_en ?? branch.address_en}
                    </p>
                    <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      {locale === "ar" ? branch.address_ar : branch.address_en}
                    </p>
                    {branch.location_url ? (
                      <a
                        href={branch.location_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> فتح على الخريطة
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </DetailSection>
        </div>
      </div>

      {/* Gallery (full width, with lightbox) */}
      <DetailSection title="معرض الصور" icon={Images} count={gallery.length}>
        {gallery.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد صور.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {gallery.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setLightbox(g.image_url)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.image_url}
                  alt={g.description ?? ""}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
                {g.description ? (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-center text-[11px] text-white">
                    {g.description}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </DetailSection>

      {/* Lightbox overlay */}
      {lightbox ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 animate-fade"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label="إغلاق"
            className="absolute end-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Star }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="mt-1 text-lg font-extrabold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function RestaurantsModule() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [viewingRestaurant, setViewingRestaurant] = useState<Restaurant | null>(null);
  const [editingRestaurant, setEditingRestaurant] = useState<Restaurant | null>(null);
  const [deletingRestaurant, setDeletingRestaurant] = useState<Restaurant | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants", debouncedSearch],
    queryFn: () => restaurantsService.getAll({ search: debouncedSearch, pageSize: 50 }),
  });

  const allCategoriesQuery = useQuery({
    queryKey: ["categories-list"],
    queryFn: () => categoriesService.getAll({ pageSize: 100 }),
  });

  const restaurantCategoriesQuery = useQuery({
    queryKey: ["restaurant-categories", editingRestaurant?.id],
    queryFn: () =>
      editingRestaurant
        ? restaurantCategoriesService.getCategoryIds(editingRestaurant.id)
        : Promise.resolve([]),
    enabled: Boolean(editingRestaurant),
  });

  const editForm = useForm<RestaurantForm>({ resolver: zodResolver(schema), defaultValues });

  // Populate category_ids when query resolves
  useEffect(() => {
    if (restaurantCategoriesQuery.data && editingRestaurant) {
      editForm.setValue("category_ids", restaurantCategoriesQuery.data);
    }
  }, [restaurantCategoriesQuery.data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["restaurants"] });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: RestaurantForm }) => {
      await restaurantsService.update(id, {
        name_ar: values.name_ar,
        name_en: values.name_en,
        description_ar: values.description_ar || null,
        description_en: values.description_en || null,
        logo_url: values.logo_url || null,
        cover_url: values.cover_url || null,
        commission_percentage: values.commission_percentage,
        estimated_delivery_time: values.estimated_delivery_time,
        accepts_online_orders: values.accepts_online_orders ?? true,
        self_delivery_enabled: values.self_delivery_enabled ?? false,
      });
      await restaurantCategoriesService.syncCategories(id, values.category_ids);
    },
    onSuccess: () => {
      toast.success(t("restaurants.updatedSuccess"));
      setEditingRestaurant(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (r: Restaurant) => restaurantsService.delete(r.id),
    onSuccess: () => {
      toast.success(t("restaurants.deletedSuccess"));
      setDeletingRestaurant(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (r: Restaurant) =>
      restaurantsService.update(r.id, { is_active: !r.is_active }),
    onSuccess: () => { toast.success(t("restaurants.updatedSuccess")); refresh(); },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const columns = useMemo<ColumnDef<Restaurant>[]>(
    () => [
      {
        id: "logo",
        header: "",
        cell: ({ row }) => {
          const r = row.original;
          return r.logo_url ? (
            <img src={r.logo_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-sm">🏪</div>
          );
        },
      },
      {
        accessorKey: locale === "ar" ? "name_ar" : "name_en",
        header: t("restaurants.field.name"),
        cell: ({ row }) =>
          locale === "ar" ? row.original.name_ar || "بدون اسم" : row.original.name_en || "No Name",
      },
      {
        accessorKey: "commission_percentage",
        header: "العمولة",
        cell: ({ row }) => `${row.original.commission_percentage}%`,
      },
      {
        accessorKey: "is_active",
        header: t("restaurants.field.isActive"),
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "success" : "secondary"}>
            {row.original.is_active ? t("restaurants.active") : t("restaurants.inactive")}
          </Badge>
        ),
      },
      {
        accessorKey: "created_at",
        header: t("restaurants.field.createdAt"),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
      {
        id: "actions",
        header: t("restaurants.field.actions"),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setViewingRestaurant(r)}>
                <Eye className="h-4 w-4" />
                عرض
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  editForm.reset({
                    name_ar: r.name_ar,
                    name_en: r.name_en,
                    description_ar: r.description_ar || "",
                    description_en: r.description_en || "",
                    logo_url: r.logo_url || "",
                    cover_url: r.cover_url || "",
                    commission_percentage: r.commission_percentage,
                    estimated_delivery_time: r.estimated_delivery_time,
                    accepts_online_orders: r.accepts_online_orders,
                    self_delivery_enabled: r.self_delivery_enabled ?? false,
                    category_ids: [],   // populated by restaurantCategoriesQuery
                  });
                  setEditingRestaurant(r);
                }}
              >
                <Edit className="h-4 w-4" />
                {t("common.edit")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => toggleActiveMutation.mutate(r)}>
                <ToggleRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeletingRestaurant(r)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [t, locale, editForm, toggleActiveMutation]
  );

  return (
    <>
      <PageHeader
        icon={Building2}
        title={t("restaurants.title")}
        description={t("restaurants.description")}
        action={
          <Button onClick={() => router.push("/restaurants/new")}>
            <Plus className="h-4 w-4" />
            {t("restaurants.createNew")}
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder={t("restaurants.searchPlaceholder")} />
      </div>

      {restaurantsQuery.isLoading ? <LoadingState /> : null}
      {restaurantsQuery.isError ? (
        <ErrorState
          description={toAppError(restaurantsQuery.error).message}
          onRetry={() => restaurantsQuery.refetch()}
        />
      ) : null}
      {restaurantsQuery.data ? (
        <DataTable
          columns={columns}
          data={restaurantsQuery.data.data}
          emptyTitle={t("restaurants.noRestaurants")}
        />
      ) : null}

      {/* Edit Dialog */}
      <FullScreenDialog
        open={Boolean(editingRestaurant)}
        onOpenChange={(open) => !open && setEditingRestaurant(null)}
        title={t("restaurants.edit")}
        description={editingRestaurant ? (locale === "ar" ? editingRestaurant.name_ar : editingRestaurant.name_en) : ""}
      >
        <RestaurantFormFields
          form={editForm}
          onSubmit={(v) =>
            editingRestaurant && updateMutation.mutate({ id: editingRestaurant.id, values: v })
          }
          isPending={updateMutation.isPending}
          submitLabel={t("common.save")}
          onCancel={() => setEditingRestaurant(null)}
          restaurantId={editingRestaurant?.id}
          allCategories={allCategoriesQuery.data?.data ?? []}
        />
      </FullScreenDialog>

      {/* Full restaurant detail */}
      <FullScreenDialog
        open={Boolean(viewingRestaurant)}
        onOpenChange={(open) => !open && setViewingRestaurant(null)}
        title="تفاصيل المطعم"
        description={
          viewingRestaurant
            ? (locale === "ar" ? viewingRestaurant.name_ar : viewingRestaurant.name_en)
            : ""
        }
      >
        {viewingRestaurant ? (
          <RestaurantDetailView restaurant={viewingRestaurant} />
        ) : null}
      </FullScreenDialog>

      <ConfirmDialog
        open={Boolean(deletingRestaurant)}
        title={t("restaurants.delete")}
        description={t("restaurants.deleteDesc")}
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => !open && setDeletingRestaurant(null)}
        onConfirm={() => deletingRestaurant && deleteMutation.mutate(deletingRestaurant)}
      />
    </>
  );
}
