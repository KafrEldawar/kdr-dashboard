import { requireSupabase } from "@/lib/supabase/client";

export type DeliveryFeeConfig = {
  base: number;
  per_km: number;
  min: number;
  max: number;
  route_factor: number;
  max_distance_km: number;
  currency: string;
};

export const DEFAULT_DELIVERY_CONFIG: DeliveryFeeConfig = {
  base: 10,
  per_km: 3,
  min: 10,
  max: 60,
  route_factor: 1.3,
  max_distance_km: 15,
  currency: "EGP",
};

const KEY = "delivery_fee_config";

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
  previewFee(config: DeliveryFeeConfig, distanceKm: number): number {
    const routed = distanceKm * config.route_factor;
    if (routed > config.max_distance_km) return 0;
    const raw = config.base + config.per_km * routed;
    return Math.max(config.min, Math.min(config.max, raw));
  },
};
