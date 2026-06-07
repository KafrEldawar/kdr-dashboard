import { requireSupabase } from "@/lib/supabase/client";

export const restaurantCategoriesService = {
  /** Returns the category IDs linked to a restaurant. */
  async getCategoryIds(restaurantId: string): Promise<string[]> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("restaurant_categories")
      .select("category_id")
      .eq("restaurant_id", restaurantId);
    if (error) throw error;
    return ((data ?? []) as { category_id: string }[]).map((r) => r.category_id);
  },

  /** Replaces all category links for a restaurant with the given IDs. */
  async syncCategories(restaurantId: string, categoryIds: string[]): Promise<void> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = supabase.from("restaurant_categories") as any;

    const { error: delError } = await table
      .delete()
      .eq("restaurant_id", restaurantId);
    if (delError) throw delError;

    if (categoryIds.length === 0) return;

    const { error: insError } = await table.insert(
      categoryIds.map((category_id) => ({ restaurant_id: restaurantId, category_id })),
    );
    if (insError) throw insError;
  },
};
