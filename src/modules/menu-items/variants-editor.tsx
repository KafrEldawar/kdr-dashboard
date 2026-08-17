"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { Modal } from "@/components/shared/modal";
import { toAppError } from "@/lib/errors";
import { menuVariantsService } from "@/services/menu";
import type { MenuItem, MenuItemVariant } from "@/types/database";

type Draft = {
  name_ar: string;
  name_en: string;
  price: string;
};

const emptyDraft: Draft = { name_ar: "", name_en: "", price: "" };

/// Sizes/crusts for one menu item.
///
/// The item's own price is deliberately NOT editable here: the
/// `trg_sync_menu_item_default_price` trigger (migration 074) keeps
/// `menu_items.price` equal to the default variant, which is what older
/// app builds read and what the customer card shows. Editing both would
/// give two sources of truth for one number.
export function VariantsEditor({
  item,
  open,
  onOpenChange,
}: {
  item: MenuItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [deleting, setDeleting] = useState<MenuItemVariant | null>(null);

  const variantsQuery = useQuery({
    queryKey: ["menu-item-variants", item?.id],
    queryFn: () => menuVariantsService.listForItem(item!.id),
    enabled: Boolean(item?.id) && open,
  });

  const variants = variantsQuery.data ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["menu-item-variants", item?.id] });
    // The item price moves with the default variant, so the table behind
    // this modal is stale the moment a variant changes.
    void queryClient.invalidateQueries({ queryKey: ["menu-items"] });
  };

  const createMutation = useMutation({
    mutationFn: async (values: Draft) => {
      const price = Number(values.price);
      return menuVariantsService.create({
        menu_item_id: item!.id,
        name_ar: values.name_ar.trim(),
        name_en: (values.name_en.trim() || values.name_ar.trim()),
        price,
        // First variant of an item becomes the default automatically —
        // an item with variants but no default would let the trigger fall
        // back to the cheapest, which is rarely what the menu means.
        is_default: variants.length === 0,
        sort_order: variants.length,
      });
    },
    onSuccess: () => {
      toast.success("تمت إضافة الحجم");
      setDraft(emptyDraft);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const priceMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      menuVariantsService.update(id, { price }),
    onSuccess: () => {
      toast.success("تم تحديث السعر");
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const defaultMutation = useMutation({
    mutationFn: (variant: MenuItemVariant) =>
      menuVariantsService.setDefault(item!.id, variant.id),
    onSuccess: () => {
      toast.success("تم تعيين الحجم الافتراضي");
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const availabilityMutation = useMutation({
    mutationFn: (variant: MenuItemVariant) =>
      menuVariantsService.update(variant.id, {
        is_available: !variant.is_available,
      }),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (variant: MenuItemVariant) =>
      menuVariantsService.delete(variant.id),
    onSuccess: () => {
      toast.success("تم حذف الحجم");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const canAdd =
    draft.name_ar.trim().length > 0 &&
    draft.price.trim().length > 0 &&
    Number.isFinite(Number(draft.price)) &&
    Number(draft.price) >= 0;

  return (
    <>
      <Modal
        size="lg"
        open={open}
        onOpenChange={onOpenChange}
        title="أحجام الصنف"
        description={
          item ? `${item.name_ar} — الأسعار هنا هي أسعار نهائية، مش فروق` : ""
        }
      >
        <div className="space-y-5">
          {variantsQuery.isLoading ? <LoadingState /> : null}
          {variantsQuery.isError ? (
            <ErrorState
              description={toAppError(variantsQuery.error).message}
              onRetry={() => variantsQuery.refetch()}
            />
          ) : null}

          {variantsQuery.data ? (
            variants.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                الصنف ده مالوش أحجام — بيتباع بسعر واحد ({item?.price} ج.م).
                <br />
                أضف حجمين أو أكتر عشان يظهر للزبون اختيار في التطبيق.
              </p>
            ) : (
              <div className="space-y-2">
                {variants.map((variant) => (
                  <VariantRow
                    key={variant.id}
                    variant={variant}
                    onPriceCommit={(price) =>
                      price !== variant.price &&
                      priceMutation.mutate({ id: variant.id, price })
                    }
                    onMakeDefault={() => defaultMutation.mutate(variant)}
                    onToggleAvailable={() => availabilityMutation.mutate(variant)}
                    onDelete={() => setDeleting(variant)}
                    busy={
                      priceMutation.isPending ||
                      defaultMutation.isPending ||
                      availabilityMutation.isPending
                    }
                  />
                ))}
              </div>
            )
          ) : null}

          {/* Add row */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-3 text-sm font-medium">إضافة حجم</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">الاسم (عربي)</Label>
                <Input
                  value={draft.name_ar}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name_ar: e.target.value }))
                  }
                  placeholder="لارج ٣٠ سم"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Name (English)</Label>
                <Input
                  dir="ltr"
                  value={draft.name_en}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name_en: e.target.value }))
                  }
                  placeholder="Large 30cm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">السعر</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={draft.price}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, price: e.target.value }))
                  }
                  placeholder="115"
                />
              </div>
              <Button
                type="button"
                disabled={!canAdd || createMutation.isPending}
                onClick={() => createMutation.mutate(draft)}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                إضافة
              </Button>
            </div>
          </div>

          {variants.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              سعر الصنف في القائمة بيتساوى تلقائياً مع الحجم الافتراضي (النجمة).
              النسخ القديمة من التطبيق بتشوف السعر ده وبتطلبه لما الزبون
              ميختارش حجم.
            </p>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="حذف الحجم"
        description={
          deleting?.is_default
            ? "ده الحجم الافتراضي — بعد الحذف سعر الصنف هيرجع لأرخص حجم متبقي."
            : "هيتشال الحجم ده من اختيارات الزبون."
        }
        confirmLabel="حذف"
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
      />
    </>
  );
}

function VariantRow({
  variant,
  onPriceCommit,
  onMakeDefault,
  onToggleAvailable,
  onDelete,
  busy,
}: {
  variant: MenuItemVariant;
  onPriceCommit: (price: number) => void;
  onMakeDefault: () => void;
  onToggleAvailable: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  // Local state so typing does not fire a mutation per keystroke; the
  // write happens on blur or Enter.
  const [price, setPrice] = useState(String(variant.price));

  const commit = () => {
    const next = Number(price);
    if (!Number.isFinite(next) || next < 0) {
      setPrice(String(variant.price));
      return;
    }
    onPriceCommit(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{variant.name_ar}</span>
          {variant.is_default ? (
            <Badge variant="default" className="gap-1">
              <Star className="h-3 w-3" />
              افتراضي
            </Badge>
          ) : null}
          {!variant.is_available ? (
            <Badge variant="secondary">موقوف</Badge>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {variant.name_en}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.5"
          min="0"
          className="w-24"
          value={price}
          disabled={busy}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <span className="text-xs text-muted-foreground">ج.م</span>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={variant.is_default || busy}
          onClick={onMakeDefault}
          title="اجعله الحجم الافتراضي"
        >
          <Star className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={onToggleAvailable}
          title={variant.is_available ? "إيقاف الحجم" : "تفعيل الحجم"}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
