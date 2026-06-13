"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MessageSquare, Star, Store } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { reviewsService } from "@/services/reviews";
import { restaurantsService } from "@/services/restaurants";
import { useLocale } from "@/lib/i18n";

// Matches the rpc_admin_get_ratings response rows.
type ReviewRow = {
  rating: number;
  review: string | null;
  user_id: string;
  order_id: string;
  user_name: string | null;
  created_at: string;
  restaurant_id: string;
  restaurant_name: string | null;
};

function StarRating({ rating, showValue = true }: { rating: number; showValue?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"
          }`}
        />
      ))}
      {showValue ? (
        <span className="ms-1.5 text-xs font-semibold text-muted-foreground">{rating}/5</span>
      ) : null}
    </div>
  );
}

function initials(name: string | null) {
  if (!name) return "؟";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function ReviewsModule() {
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [restaurantFilter, setRestaurantFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const debouncedSearch = useDebouncedValue(search);

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-picker"],
    queryFn: () => restaurantsService.getAll({ pageSize: 100 }),
  });

  const reviewsQuery = useQuery({
    queryKey: ["reviews", restaurantFilter, ratingFilter],
    queryFn: () =>
      reviewsService.getAll({
        filters: {
          restaurant_id: restaurantFilter !== "all" ? restaurantFilter : undefined,
          rating: ratingFilter !== "all" ? Number(ratingFilter) : undefined,
        },
      }),
  });

  const restaurants = restaurantsQuery.data?.data ?? [];

  const columns = useMemo<ColumnDef<ReviewRow>[]>(
    () => [
      {
        accessorKey: "restaurant_name",
        header: "المطعم",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Store className="h-3.5 w-3.5" />
            </span>
            {row.original.restaurant_name?.trim() || row.original.restaurant_id.slice(0, 8)}
          </div>
        ),
      },
      {
        accessorKey: "user_name",
        header: "العميل",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
              {initials(row.original.user_name)}
            </span>
            <span className="text-sm">{row.original.user_name?.trim() || "—"}</span>
          </div>
        ),
      },
      {
        accessorKey: "rating",
        header: "التقييم",
        cell: ({ row }) => <StarRating rating={row.original.rating} />,
      },
      {
        accessorKey: "review",
        header: "التعليق",
        cell: ({ row }) =>
          row.original.review?.trim() ? (
            <span className="block max-w-[280px] truncate text-sm">{row.original.review}</span>
          ) : (
            <span className="text-xs text-muted-foreground">بدون تعليق</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: "التاريخ",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDate(row.original.created_at, locale)}
          </span>
        ),
      },
    ],
    [locale]
  );

  const data = (reviewsQuery.data?.data ?? []) as ReviewRow[];
  const total = reviewsQuery.data?.count ?? data.length;
  const filtered = debouncedSearch
    ? data.filter((r) => r.review?.toLowerCase().includes(debouncedSearch.toLowerCase()))
    : data;
  const average = data.length
    ? data.reduce((sum, r) => sum + (r.rating ?? 0), 0) / data.length
    : 0;
  const withComment = data.filter((r) => r.review?.trim()).length;

  return (
    <>
      <PageHeader
        icon={MessageSquare}
        title="التقييمات"
        description="تقييمات العملاء للمطاعم وتعليقاتهم."
      />

      {/* Summary */}
      {reviewsQuery.data ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-sm font-medium text-muted-foreground">متوسط التقييم</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-2xl font-extrabold tabular-nums">{average.toFixed(1)}</span>
              <StarRating rating={Math.round(average)} showValue={false} />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-sm font-medium text-muted-foreground">إجمالي التقييمات</p>
            <p className="mt-1.5 text-2xl font-extrabold tabular-nums">{total}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-sm font-medium text-muted-foreground">تقييمات بتعليق</p>
            <p className="mt-1.5 text-2xl font-extrabold tabular-nums">{withComment}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="ابحث في التعليقات…" />
        <div className="w-full md:w-52">
          <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
            <SelectTrigger>
              <SelectValue placeholder="كل المطاعم" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المطاعم</SelectItem>
              {restaurants.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {locale === "ar" ? r.name_ar : r.name_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full md:w-36">
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger>
              <SelectValue placeholder="كل التقييمات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل التقييمات</SelectItem>
              {[5, 4, 3, 2, 1].map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r} نجوم
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {reviewsQuery.isLoading ? <LoadingState /> : null}
      {reviewsQuery.isError ? (
        <ErrorState
          description={toAppError(reviewsQuery.error).message}
          onRetry={() => reviewsQuery.refetch()}
        />
      ) : null}
      {reviewsQuery.data ? (
        <DataTable columns={columns} data={filtered} emptyTitle="لا يوجد تقييمات" />
      ) : null}
    </>
  );
}
