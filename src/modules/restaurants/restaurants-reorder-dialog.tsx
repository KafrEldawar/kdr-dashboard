"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { FullScreenDialog } from "@/components/shared/full-screen-dialog";
import { Button } from "@/components/ui/button";
import { adminService } from "@/services/admin";
import { toAppError } from "@/lib/errors";
import { useLocale } from "@/lib/i18n";
import type { Restaurant } from "@/types/database";

// Dashboard-side reorder screen. The admin drags rows (or uses the
// arrow buttons for keyboard/no-DnD accessibility) into the order
// they want; on save we ship the full ordered id list to
// `rpc_admin_reorder_restaurants` which reassigns display_order
// 1..N in one transaction. Nothing is written until Save.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurants: Restaurant[];
  onSaved: () => void;
};

export function RestaurantsReorderDialog({ open, onOpenChange, restaurants, onSaved }: Props) {
  const locale = useLocale();
  // Sort the incoming list by (display_order NULLS LAST, created_at DESC)
  // so what the admin sees matches what the customer app shows today.
  const initial = useMemo(() => sortForDisplay(restaurants), [restaurants]);

  const [items, setItems] = useState<Restaurant[]>(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Re-seed when the dialog opens or the incoming list changes.
  useEffect(() => {
    if (open) setItems(sortForDisplay(restaurants));
  }, [open, restaurants]);

  const dirty = useMemo(() => {
    if (items.length !== initial.length) return true;
    return items.some((r, i) => r.id !== initial[i]?.id);
  }, [items, initial]);

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    setItems((prev) => {
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: () => adminService.reorderRestaurants(items.map((r) => r.id)),
    onSuccess: () => {
      toast.success("تم حفظ الترتيب الجديد");
      onSaved();
      onOpenChange(false);
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && dirty) {
      const ok = window.confirm("فيه تغييرات مش متحفوظة. تخرج من غير حفظ؟");
      if (!ok) return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <FullScreenDialog
      open={open}
      onOpenChange={handleClose}
      title="ترتيب المطاعم"
      description="اسحب المطعم لأعلى أو لأسفل عشان تغيّر ترتيبه في الهوم. لا يتم حفظ التغييرات إلا بالضغط على «حفظ»."
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          <p>
            الترتيب من فوق لتحت هو نفس الترتيب اللي هيظهر في الهوم.
            المطاعم اللي ما اتحطش لها ترتيب هتيجي في الآخر بالترتيب اللي هو ماشي عليه دلوقتي.
          </p>
        </div>

        <ol className="flex flex-col gap-2">
          {items.map((r, i) => {
            const dragging = dragIndex === i;
            const isDropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <li
                key={r.id}
                draggable
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDragLeave={() => {
                  if (overIndex === i) setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData("text/plain"));
                  if (!Number.isNaN(from)) move(from, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={[
                  "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
                  dragging ? "opacity-40" : "",
                  isDropTarget ? "border-primary ring-2 ring-primary/40" : "border-border",
                ].join(" ")}
              >
                <span
                  className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                  aria-hidden
                >
                  <GripVertical className="h-5 w-5" />
                </span>
                <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded bg-muted text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                {r.logo_url ? (
                  <img src={r.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">🏪</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {locale === "ar" ? r.name_ar || "بدون اسم" : r.name_en || "No name"}
                  </div>
                  {r.display_order != null ? (
                    <div className="text-xs text-muted-foreground">الترتيب الحالي: {r.display_order}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">بدون ترتيب مخصص</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="فوق"
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="تحت"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-background/95 p-4 backdrop-blur sm:-mx-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? "جاري الحفظ…" : "حفظ الترتيب"}
          </Button>
        </div>
      </div>
    </FullScreenDialog>
  );
}

function sortForDisplay(list: Restaurant[]): Restaurant[] {
  return list.slice().sort((a, b) => {
    const ao = a.display_order;
    const bo = b.display_order;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
}
