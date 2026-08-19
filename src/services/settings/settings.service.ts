import { requireSupabase } from "@/lib/supabase/client";

export type DeliveryFeeConfig = {
  base: number;
  per_km: number;
  /// Kilometres included in `base` before `per_km` starts billing
  /// (migration 078). 0 reproduces the pre-078 "bill from the first metre"
  /// behaviour, which is what a config saved by an older dashboard means.
  free_km: number;
  min: number;
  max: number;
  route_factor: number;
  max_distance_km: number;
  currency: string;
};

export const DEFAULT_DELIVERY_CONFIG: DeliveryFeeConfig = {
  base: 20,
  per_km: 5,
  free_km: 2,
  min: 20,
  max: 85,
  route_factor: 1.3,
  max_distance_km: 15,
  currency: "EGP",
};

const KEY = "delivery_fee_config";

/// Platform-wide online-ordering switch (migration 072).
///
/// Deliberately separate from each restaurant's `accepts_online_orders`:
/// pausing globally must not overwrite what a restaurant chose for itself,
/// or "turn everything back on" would reopen restaurants that were closed
/// on purpose.
export type OrderingStatus = {
  online_ordering_enabled: boolean;
  paused_reason_ar: string | null;
  paused_at: string | null;
};

export const DEFAULT_ORDERING_STATUS: OrderingStatus = {
  online_ordering_enabled: true,
  paused_reason_ar: null,
  paused_at: null,
};

export const orderingStatusService = {
  async get(): Promise<OrderingStatus> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("rpc_get_ordering_status");
    if (error) throw error;
    return { ...DEFAULT_ORDERING_STATUS, ...(data as Partial<OrderingStatus>) };
  },

  /// `reasonAr` is shown to customers in the app, so it should read like a
  /// sentence to a customer, not an incident ticket.
  async set(enabled: boolean, reasonAr?: string): Promise<OrderingStatus> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      "rpc_admin_set_ordering_status",
      { p_enabled: enabled, p_reason_ar: reasonAr ?? null }
    );
    if (error) throw error;
    if (data?.error) throw new Error(data.error as string);
    return { ...DEFAULT_ORDERING_STATUS, ...(data as Partial<OrderingStatus>) };
  },
};

export const settingsService = {
  async getDeliveryConfig(): Promise<DeliveryFeeConfig> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DEFAULT_DELIVERY_CONFIG;
    return { ...DEFAULT_DELIVERY_CONFIG, ...(data.value as Partial<DeliveryFeeConfig>) };
  },

  async updateDeliveryConfig(value: DeliveryFeeConfig): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: KEY, value }, { onConflict: "key" });
    if (error) throw error;
  },

  /// Returns the predicted fee for a hypothetical distance — useful for the
  /// live preview shown next to the form.
  /// Must stay in lockstep with `compute_delivery_fee` (migration 078).
  /// The first `free_km` of the routed distance are included in `base`;
  /// only the surplus is billed.
  previewFee(config: DeliveryFeeConfig, distanceKm: number): number {
    const routed = distanceKm * config.route_factor;
    if (routed > config.max_distance_km) return 0;
    const billable = Math.max(routed - (config.free_km ?? 0), 0);
    const raw = config.base + config.per_km * billable;
    return Math.max(config.min, Math.min(config.max, raw));
  },
};
