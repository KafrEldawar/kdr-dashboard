"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
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

type ReviewRow = {
  id: string;
  restaurant_id: string;
  user_id: string;
  restaurant_rating: number;
  restaurant_review: string | null;
  rated_at: string | null;
  created_at: string;
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
        />
      ))}
      <span className="text-xs text-muted-foreground ms-1">{rating}/5</span>
    </div>
  );
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
    queryKey: ["reviews", restaurantFilter, ratingFilter, debouncedSearch],
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
        accessorKey: "restaurant_id",
        header: "المطعم",
        cell: ({ row }) => {
          const r = restaurants.find((x) => x.id === row.original.restaurant_id);
          return r ? (locale === "ar" ? r.name_ar : r.name_en) : row.original.restaurant_id.slice(0, 8);
        },
      },
      {
        accessorKey: "restaurant_rating",
        header: "التقييم",
        cell: ({ row }) => <StarRating rating={row.original.restaurant_rating} />,
      },
      {
        accessorKey: "restaurant_review",
        header: "التعليق",
        cell: ({ row }) => (
          <span className="max-w-[250px] truncate block text-sm">
            {row.original.restaurant_review || "—"}
          </span>
        ),
      },
      {
        accessorKey: "rated_at",
        header: "التاريخ",
        cell: ({ row }) =>
          row.original.rated_at ? formatDate(row.original.rated_at, locale) : "—",
      },
    ],
    [locale, restaurants]
  );

  const data = (reviewsQuery.data?.data ?? []) as ReviewRow[];
  const filtered = debouncedSearch
    ? data.filter((r) =>
        r.restaurant_review?.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : data;

  return (
    <>
      <PageHeader title="التقييمات" description="تقييمات العملاء للمطاعم (من جدول orders)." />

      <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="ابحث في التعليقات…"
        />
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
