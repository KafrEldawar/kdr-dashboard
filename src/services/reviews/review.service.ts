import { requireSupabase } from "@/lib/supabase/client";

export type ReviewFilters = {
  restaurant_id?: string;
  rating?: number;
};

export const reviewsService = {
  async getAll(params: { page?: number; pageSize?: number; filters?: ReviewFilters } = {}) {
    const supabase = requireSupabase();
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("rpc_admin_get_ratings", {
      p_restaurant_id: params.filters?.restaurant_id ?? null,
      p_rating: params.filters?.rating ?? null,
      p_page: page,
      p_page_size: pageSize,
    });

    if (error) throw error;
    const result = data as { data: unknown[]; meta: { total: number } };
    return {
      data: result.data,
      count: result.meta.total,
    };
  },
};
