"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Edit, Eye, ToggleRight, Trash2, Plus, Star, MapPin,
  Clock, Bike, ShoppingBag, Building2, Tag, ChevronRight, Images,
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
import { AddRestaurantWizard } from "./add-restaurant-wizard";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService } from "@/services/admin";
import { restaurantsService } from "@/services/restaurants";
import { branchesService } from "@/services/branches";
import { menuItemsService } from "@/services/menu";
import { offersService } from "@/services/offers";
import { requireSupabase } from "@/lib/supabase/client";
import { useTranslations, useLocale } from "@/lib/i18n";
import type { Branch, MenuItem, Offer, Restaurant, RestaurantGallery } from "@/types/database";

const schema = z.object({
  name_ar: z.string().min(2, "اسم المطعم بالعربية مطلوب"),
  name_en: z.string().min(2, "Restaurant name in English is required"),
  description_ar: z.string().optional(),
  description_en: z.string().optional(),
  logo_url: z.string().optional(),
  cover_url: z.string().optional(),
  delivery_fee: z.coerce.number().min(0).optional(),
  min_order_amount: z.coerce.number().min(0).optional(),
  estimated_delivery_time: z.coerce.number().min(1).optional(),
  accepts_online_orders: z.boolean().default(true).optional(),
});

type RestaurantForm = z.infer<typeof schema>;

const defaultValues: RestaurantForm = {
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
      const { error } = await supabase.from("restaurant_gallery").insert({
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
}: {
  form: ReturnType<typeof useForm<RestaurantForm>>;
  onSubmit: (v: RestaurantForm) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
  restaurantId?: string;
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
        <FormField label="رسوم التوصيل (ج.م)" error={form.formState.errors.delivery_fee?.message}>
          <Input {...form.register("delivery_fee")} type="number" step="0.5" />
        </FormField>
        <FormField label="أدنى طلب (ج.م)">
          <Input {...form.register("min_order_amount")} type="number" step="0.5" />
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
      </div>

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

function RestaurantDetailView({ restaurant }: { restaurant: Restaurant }) {
  const locale = useLocale();

  const branchesQuery = useQuery({
    queryKey: ["restaurant-branches", restaurant.id],
    queryFn: () => branchesService.filters({ restaurant_id: restaurant.id }, { pageSize: 20 }),
  });

  const menuQuery = useQuery({
    queryKey: ["restaurant-menu", restaurant.id],
    queryFn: () => menuItemsService.filters({ restaurant_id: restaurant.id }, { pageSize: 100 }),
  });

  const offersQuery = useQuery({
    queryKey: ["restaurant-offers", restaurant.id],
    queryFn: () => offersService.filters({ restaurant_id: restaurant.id }, { pageSize: 20 }),
  });

  const ratingsQuery = useQuery({
    queryKey: ["restaurant-ratings", restaurant.id],
    queryFn: () => adminService.getRatings({ restaurantId: restaurant.id, pageSize: 5 }),
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

  const name = locale === "ar" ? restaurant.name_ar : restaurant.name_en;
  const description = locale === "ar" ? restaurant.description_ar : restaurant.description_en;
  const branches: Branch[] = branchesQuery.data?.data ?? [];
  const menuItems: MenuItem[] = menuQuery.data?.data ?? [];
  const offers: Offer[] = offersQuery.data?.data ?? [];
  const gallery: RestaurantGallery[] = galleryQuery.data ?? [];
  const ratings = (ratingsQuery.data ?? []) as {
    id: string;
    rating: number;
    comment?: string;
    reviewer?: { full_name?: string };
  }[];

  return (
    <div className="mx-auto max-w-sm">
      <div className="overflow-hidden rounded-3xl border-4 border-foreground/20 bg-white shadow-2xl dark:bg-zinc-900">
        {/* Cover */}
        <div className="relative h-44 bg-gradient-to-br from-orange-200 to-amber-300">
          {restaurant.cover_url ? (
            <img src={restaurant.cover_url} alt="cover" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-5xl opacity-30">🍽️</div>
          )}
          {/* Logo */}
          <div className="absolute -bottom-8 right-4 h-16 w-16 overflow-hidden rounded-2xl border-4 border-white bg-white shadow-lg dark:border-zinc-900">
            {restaurant.logo_url ? (
              <img src={restaurant.logo_url} alt="logo" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-2xl">🏪</div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="px-4 pb-4 pt-10">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">{name}</h2>
              {description ? (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{description}</p>
              ) : null}
            </div>
            <Badge variant={restaurant.is_active ? "default" : "secondary"} className="mt-1 shrink-0">
              {restaurant.is_active ? "مفتوح" : "مغلق"}
            </Badge>
          </div>

          {/* Chips */}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs text-orange-700 dark:bg-orange-950/30">
              <Bike className="h-3 w-3" />{restaurant.delivery_fee} ج.م
            </span>
            <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:bg-blue-950/30">
              <Clock className="h-3 w-3" />{restaurant.estimated_delivery_time} دقيقة
            </span>
            <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700 dark:bg-green-950/30">
              <ShoppingBag className="h-3 w-3" />أدنى {restaurant.min_order_amount} ج.م
            </span>
            {restaurant.accepts_online_orders ? (
              <span className="flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-xs text-purple-700 dark:bg-purple-950/30">
                ✓ أونلاين
              </span>
            ) : null}
          </div>

          {/* Active Offers */}
          {offers.filter((o) => o.is_active).length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">العروض</p>
              <div className="space-y-1.5">
                {offers.filter((o) => o.is_active).map((offer) => (
                  <div key={offer.id} className="flex items-center gap-2 rounded-xl bg-orange-50 p-2.5 dark:bg-orange-950/20">
                    {offer.image_url ? (
                      <img src={offer.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-200 text-xl">🏷️</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">
                        {locale === "ar" ? offer.title_ar : (offer.title_en ?? offer.title_ar)}
                      </p>
                      <p className="text-xs text-orange-700">خصم {offer.discount_percentage}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Menu */}
          {menuItems.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">قائمة الطعام</p>
              <div className="space-y-1.5">
                {menuItems.slice(0, 6).map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border bg-background p-2.5">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-xl">🍴</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {locale === "ar" ? item.name_ar : (item.name_en ?? item.name_ar)}
                      </p>
                      {item.description_ar ? (
                        <p className="truncate text-xs text-muted-foreground">{item.description_ar}</p>
                      ) : null}
                      <p className="text-xs font-semibold text-orange-600">{item.price} ج.م</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
                {menuItems.length > 6 ? (
                  <p className="py-1 text-center text-xs text-muted-foreground">
                    + {menuItems.length - 6} عنصر آخر
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Branches */}
          {branches.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">الفروع</p>
              <div className="space-y-1.5">
                {branches.map((branch) => (
                  <div key={branch.id} className="flex items-start gap-2 rounded-xl border p-2.5">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-medium">
                        {locale === "ar"
                          ? (branch.name_ar ?? branch.address_ar)
                          : (branch.name_en ?? branch.address_en)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {locale === "ar" ? branch.address_ar : branch.address_en}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Ratings */}
          {ratings.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">التقييمات</p>
              <div className="space-y-1.5">
                {ratings.map((r) => (
                  <div key={r.id} className="rounded-xl border p-2.5">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3 w-3 ${i < r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
                        />
                      ))}
                      <span className="mr-1 text-xs text-muted-foreground">
                        {r.reviewer?.full_name ?? "مستخدم"}
                      </span>
                    </div>
                    {r.comment ? <p className="mt-1 text-xs text-muted-foreground">{r.comment}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Gallery */}
          {gallery.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">معرض الصور</p>
              <div className="grid grid-cols-3 gap-1.5">
                {gallery.map((g) => (
                  <div key={g.id} className="group relative overflow-hidden rounded-xl">
                    <img
                      src={g.image_url}
                      alt={g.description ?? ""}
                      className="h-20 w-full object-cover"
                    />
                    {g.description ? (
                      <div className="absolute inset-x-0 bottom-0 bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <p className="truncate text-center text-[10px] text-white">{g.description}</p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Stats */}
          <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{branches.length} فرع</span>
            <span className="flex items-center gap-1"><Tag className="h-3.5 w-3.5" />{menuItems.length} صنف</span>
            <span className="flex items-center gap-1"><Images className="h-3.5 w-3.5" />{gallery.length} صورة</span>
            <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5" />{ratings.length} تقييم</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RestaurantsModule() {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [viewingRestaurant, setViewingRestaurant] = useState<Restaurant | null>(null);
  const [editingRestaurant, setEditingRestaurant] = useState<Restaurant | null>(null);
  const [deletingRestaurant, setDeletingRestaurant] = useState<Restaurant | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants", debouncedSearch],
    queryFn: () => restaurantsService.getAll({ search: debouncedSearch, pageSize: 50 }),
  });

  const editForm = useForm<RestaurantForm>({ resolver: zodResolver(schema), defaultValues });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["restaurants"] });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: RestaurantForm }) =>
      restaurantsService.update(id, {
        name_ar: values.name_ar,
        name_en: values.name_en,
        description_ar: values.description_ar || null,
        description_en: values.description_en || null,
        logo_url: values.logo_url || null,
        cover_url: values.cover_url || null,
        delivery_fee: values.delivery_fee,
        min_order_amount: values.min_order_amount,
        estimated_delivery_time: values.estimated_delivery_time,
        accepts_online_orders: values.accepts_online_orders ?? true,
      }),
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
        accessorKey: "delivery_fee",
        header: "رسوم التوصيل",
        cell: ({ row }) => `${row.original.delivery_fee} ج.م`,
      },
      {
        accessorKey: "is_active",
        header: t("restaurants.field.isActive"),
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "default" : "destructive"}>
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
                  setEditingRestaurant(r);
                  editForm.reset({
                    name_ar: r.name_ar,
                    name_en: r.name_en,
                    description_ar: r.description_ar || "",
                    description_en: r.description_en || "",
                    logo_url: r.logo_url || "",
                    cover_url: r.cover_url || "",
                    delivery_fee: r.delivery_fee,
                    min_order_amount: r.min_order_amount,
                    estimated_delivery_time: r.estimated_delivery_time,
                    accepts_online_orders: r.accepts_online_orders,
                  });
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
        title={t("restaurants.title")}
        description={t("restaurants.description")}
        action={
          <Button onClick={() => setAddOpen(true)}>
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

      {/* Add Dialog — full wizard */}
      <FullScreenDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("restaurants.createNew")}
      >
        <AddRestaurantWizard
          onSuccess={() => { setAddOpen(false); refresh(); }}
          onCancel={() => setAddOpen(false)}
        />
      </FullScreenDialog>

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
        />
      </FullScreenDialog>

      {/* Mobile Preview Dialog */}
      <FullScreenDialog
        open={Boolean(viewingRestaurant)}
        onOpenChange={(open) => !open && setViewingRestaurant(null)}
        title="معاينة تطبيق الموبايل"
        description={
          viewingRestaurant
            ? (locale === "ar" ? viewingRestaurant.name_ar : viewingRestaurant.name_en)
            : ""
        }
      >
        {viewingRestaurant ? (
          <div className="flex items-start justify-center p-6">
            <RestaurantDetailView restaurant={viewingRestaurant} />
          </div>
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
