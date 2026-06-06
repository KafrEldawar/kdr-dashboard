"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { requireSupabase } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n";

type CartRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

type CartItem = {
  id: string;
  cart_id: string;
  menu_item_id: string;
  quantity: number;
  special_instructions: string | null;
};

async function fetchCarts() {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("carts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as CartRow[];
}

async function fetchCartItems(cartId: string) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("cart_items")
    .select("*")
    .eq("cart_id", cartId);
  if (error) throw error;
  return (data ?? []) as CartItem[];
}

function CartItemsPanel({ cartId }: { cartId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["cart-items", cartId],
    queryFn: () => fetchCartItems(cartId),
  });

  if (isLoading) return <p className="text-xs text-muted-foreground p-2">جاري التحميل…</p>;
  if (isError) return <p className="text-xs text-destructive p-2">{toAppError(error).message}</p>;
  if (!data?.length) return <p className="text-xs text-muted-foreground p-2">السلة فارغة</p>;

  return (
    <div className="space-y-1 p-2">
      {data.map((item) => (
        <div key={item.id} className="flex items-center justify-between rounded border bg-muted/30 px-3 py-1.5 text-xs">
          <span className="font-mono">{item.menu_item_id.slice(0, 8)}…</span>
          <Badge variant="outline">× {item.quantity}</Badge>
          {item.special_instructions ? (
            <span className="text-muted-foreground truncate max-w-[150px]">{item.special_instructions}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function CartModule() {
  const locale = useLocale();
  const [expandedCart, setExpandedCart] = useState<string | null>(null);

  const cartsQuery = useQuery({
    queryKey: ["carts"],
    queryFn: fetchCarts,
  });

  const columns = useMemo<ColumnDef<CartRow>[]>(
    () => [
      {
        id: "expand",
        header: "",
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setExpandedCart(expandedCart === row.original.id ? null : row.original.id)
            }
          >
            {expandedCart === row.original.id ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        ),
      },
      {
        accessorKey: "id",
        header: "معرّف السلة",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.id.slice(0, 12)}…</span>
        ),
      },
      {
        accessorKey: "user_id",
        header: "المستخدم",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.user_id.slice(0, 12)}…</span>
        ),
      },
      {
        accessorKey: "updated_at",
        header: "آخر تحديث",
        cell: ({ row }) => formatDate(row.original.updated_at, locale),
      },
    ],
    [locale, expandedCart]
  );

  return (
    <>
      <PageHeader
        title="السلات"
        description="عرض سلات التسوق النشطة للمستخدمين (قراءة فقط)."
      />

      <div className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <ShoppingCart className="inline h-4 w-4 me-1" />
        كل مستخدم له سلة واحدة تُنشأ تلقائياً عند أول إضافة. اضغط على الصف لعرض العناصر.
      </div>

      {cartsQuery.isLoading ? <LoadingState /> : null}
      {cartsQuery.isError ? (
        <ErrorState
          description={toAppError(cartsQuery.error).message}
          onRetry={() => cartsQuery.refetch()}
        />
      ) : null}

      {cartsQuery.data ? (
        <div className="space-y-2">
          {cartsQuery.data.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                لا يوجد سلات نشطة
              </CardContent>
            </Card>
          ) : null}
          {cartsQuery.data.map((cart) => (
            <Card key={cart.id} className="overflow-hidden">
              <CardHeader
                className="py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedCart(expandedCart === cart.id ? null : cart.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {expandedCart === cart.id ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <CardTitle className="text-sm font-mono">{cart.id.slice(0, 16)}…</CardTitle>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(cart.updated_at, locale)}
                  </span>
                </div>
              </CardHeader>
              {expandedCart === cart.id ? (
                <CardContent className="pt-0 pb-3">
                  <CartItemsPanel cartId={cart.id} />
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
