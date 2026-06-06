"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Heart } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminService, type FavoriteRow } from "@/services/admin";
import { restaurantsService } from "@/services/restaurants";
import { useLocale } from "@/lib/i18n";

export function FavoritesModule() {
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [restaurantFilter, setRestaurantFilter] = useState("all");
  const debouncedSearch = useDebouncedValue(search);

  const favoritesQuery = useQuery({
    queryKey: ["favorites", restaurantFilter],
    queryFn: () =>
      adminService.listFavorites({
        restaurantId: restaurantFilter !== "all" ? restaurantFilter : undefined,
        pageSize: 100,
      }),
    retry: false,
  });

  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-picker"],
    queryFn: () => restaurantsService.getAll({ pageSize: 100 }),
  });

  const restaurants = restaurantsQuery.data?.data ?? [];
  const allFavorites = favoritesQuery.data?.data ?? [];

  const filtered = debouncedSearch
    ? allFavorites.filter(
        (f) =>
          f.user_name?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          f.restaurant_name_ar.includes(debouncedSearch) ||
          f.restaurant_name_en.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : allFavorites;

  const topRestaurants = restaurants
    .map((r) => ({
      ...r,
      favCount: allFavorites.filter((f) => f.restaurant_id === r.id).length,
    }))
    .filter((r) => r.favCount > 0)
    .sort((a, b) => b.favCount - a.favCount)
    .slice(0, 4);

  const columns = useMemo<ColumnDef<FavoriteRow>[]>(
    () => [
      {
        accessorKey: "user_name",
        header: "المستخدم",
        cell: ({ row }) => row.original.user_name ?? "—",
      },
      {
        accessorKey: "restaurant_name_ar",
        header: "المطعم",
        cell: ({ row }) =>
          locale === "ar"
            ? row.original.restaurant_name_ar
            : row.original.restaurant_name_en,
      },
      {
        accessorKey: "created_at",
        header: "أُضيف",
        cell: ({ row }) => formatDate(row.original.created_at, locale),
      },
    ],
    [locale]
  );

  return (
    <>
      <PageHeader
        title="المفضلة"
        description="المطاعم المفضلة للمستخدمين."
      />

      {topRestaurants.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
          {topRestaurants.map((r) => (
            <StatCard
              key={r.id}
              label={locale === "ar" ? r.name_ar : r.name_en}
              value={String(r.favCount)}
              icon={Heart}
              note="مرة في المفضلة"
            />
          ))}
        </section>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="ابحث بالمستخدم أو المطعم…"
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
      </div>

      {favoritesQuery.isLoading ? <LoadingState /> : null}
      {favoritesQuery.isError ? (
        <ErrorState
          description={toAppError(favoritesQuery.error).message}
          onRetry={() => favoritesQuery.refetch()}
        />
      ) : null}
      {favoritesQuery.data ? (
        <DataTable
          columns={columns}
          data={filtered}
          emptyTitle="لا يوجد مفضلات بعد"
        />
      ) : null}
    </>
  );
}
