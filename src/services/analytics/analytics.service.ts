import { requireSupabase } from "@/lib/supabase/client";

export type ProductAnalytics = {
  range_days: number;
  since: string;
  totals: {
    events: number;
    sessions: number;
    known_users: number;
    guest_sessions: number;
    events_today: number;
  };
  daily: { day: string; users: number; sessions: number; events: number }[];
  /** `users` counts distinct actors; `count` counts raw fires. */
  top_events: { event: string; count: number; users: number }[];
  top_screens: { screen: string; views: number; users: number }[];
  funnel: {
    restaurant_viewed: number;
    add_to_cart: number;
    checkout_started: number;
    order_placed: number;
  };
  platforms: { platform: string; sessions: number; events: number }[];
  versions: { app_version: string; sessions: number }[];
};

export const analyticsService = {
  /**
   * Reads the first-party `app_events` table (migration 065). Returns
   * empty/zeroed sections until a build carrying AnalyticsService is
   * actually in users' hands — there is no backfill for events that
   * were never collected.
   */
  async getProductAnalytics(days = 30): Promise<ProductAnalytics> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "rpc_admin_get_product_analytics",
      { p_days: days }
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error as string);
    return data as ProductAnalytics;
  },

  async getDashboardStats() {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("rpc_admin_get_stats");
    if (error) throw error;
    return data as {
      restaurants: number;
      restaurant_owners: number;
      users: number;
      categories: number;
      offers: number;
      vouchers: number;
      orders_total: number;
      orders_today: number;
      orders_pending: number;
      revenue_today: number;
      ratings_total: number;
    };
  },

  async getDashboardTotals() {
    const supabase = requireSupabase();
    const [profiles, restaurants, orders, menuItems, vouchers] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("restaurants").select("*", { count: "exact", head: true }),
      supabase.from("orders").select("*", { count: "exact", head: true }),
      supabase.from("menu_items").select("*", { count: "exact", head: true }),
      supabase.from("vouchers").select("*", { count: "exact", head: true }),
    ]);

    return {
      users: profiles.count ?? 0,
      restaurants: restaurants.count ?? 0,
      orders: orders.count ?? 0,
      menuItems: menuItems.count ?? 0,
      vouchers: vouchers.count ?? 0,
    };
  },
};
