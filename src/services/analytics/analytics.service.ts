import { requireSupabase } from "@/lib/supabase/client";

export const analyticsService = {
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
