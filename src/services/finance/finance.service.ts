import { requireSupabase } from "@/lib/supabase/client";

export type FinancialTotals = {
  orders_count: number;
  gross_sales: number;
  platform_revenue: number;
  restaurant_revenue: number;
  /// Count of completed orders where the restaurant did the delivery
  /// themselves instead of the driver pool (migration 044).
  self_delivery_orders_count: number;
  /// Sum of `delivery_fee` on those orders. Goes 100% to the restaurant —
  /// no platform commission applies to delivery.
  self_delivery_earnings: number;
};

export type FinancialPeriod = FinancialTotals & { period: string };

export type FinancialRestaurantRow = {
  restaurant_id: string;
  name_ar: string;
  name_en: string;
  current_commission_percentage: number;
  orders_count: number;
  gross_sales: number;
  platform_revenue: number;
  restaurant_revenue: number;
  self_delivery_orders_count: number;
  self_delivery_earnings: number;
};

export type FinancialReport = {
  from: string;
  to: string;
  group_by: "day" | "month";
  totals: FinancialTotals;
  periods: FinancialPeriod[];
  restaurants: FinancialRestaurantRow[];
};

export type UnclaimedOrder = {
  id: string;
  status: string;
  total_amount: number;
  delivery_address: string | null;
  accepted_at: string;
  estimated_preparation_minutes: number | null;
  overdue_minutes: number;
  restaurant: { id: string; name_ar: string; name_en: string };
  customer_name: string | null;
};

export const financeService = {
  async getReport(params: {
    from: string;
    to: string;
    restaurantId?: string;
    groupBy?: "day" | "month";
  }): Promise<FinancialReport> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "rpc_admin_get_financial_report",
      {
        p_from: params.from,
        p_to: params.to,
        p_restaurant_id: params.restaurantId ?? null,
        p_group_by: params.groupBy ?? "day",
      }
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data as FinancialReport;
  },

  async getUnclaimedOrders(): Promise<UnclaimedOrder[]> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "rpc_admin_get_unclaimed_orders"
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return (data ?? []) as UnclaimedOrder[];
  },
};
