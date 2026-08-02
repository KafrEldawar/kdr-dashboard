import { requireSupabase } from "@/lib/supabase/client";

/** Individual rider vs delivery office. */
export type DeliveryProviderKind = "individual" | "office";

export type DeliveryProvider = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_available: boolean;
  /** Null until the account has a `delivery_providers` row (pre-067 accounts). */
  kind: DeliveryProviderKind | null;
  display_name: string | null;
  max_concurrent_orders: number | null;
  is_active: boolean | null;
  /** Orders currently held (preparing / ready_for_pickup / out_for_delivery). */
  active_orders: number;
  couriers: number;
  /** Cash collected from customers but not yet handed in. */
  unsettled_amount: number;
};

export type OfficeCourier = {
  id: string;
  office_id: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
};

export type ProviderSettlement = {
  id: string;
  provider_id: string;
  courier_id: string | null;
  orders_count: number;
  total_collected: number;
  total_restaurant_paid: number;
  total_delivery_fees: number;
  expected_amount: number;
  received_amount: number;
  difference: number;
  note: string | null;
  created_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpc(name: string, args?: Record<string, unknown>): Promise<{ data: any; error: any }> {
  const supabase = requireSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).rpc(name, args).then((result: { data: any; error: any }) => {
    // These RPCs signal failure as `{error: '...'}` in the JSON payload
    // rather than a DB-level error, so normalise before callers see it.
    if (!result.error && result.data?.error) {
      return { data: null, error: new Error(result.data.error as string) };
    }
    return result;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return requireSupabase() as any;
}

export const deliveryProviderService = {
  /**
   * Every driver account with its delivery settings and live workload.
   *
   * Assembled client-side from three reads rather than one view: the
   * counts are small (a handful of accounts), and adding a server-side
   * aggregate would mean another migration for a page that renders a
   * dozen rows.
   */
  async list(): Promise<DeliveryProvider[]> {
    const [profilesRes, providersRes, couriersRes, ordersRes] = await Promise.all([
      db().from("profiles").select("id, full_name, phone, is_available").eq("role", "driver"),
      db()
        .from("delivery_providers")
        .select("id, kind, display_name, max_concurrent_orders, is_active"),
      db().from("office_couriers").select("id, office_id, is_active"),
      db()
        .from("orders")
        .select("driver_id, status, settlement_id, total_amount, collected_amount, subtotal, discount")
        .not("driver_id", "is", null),
    ]);

    const firstError =
      profilesRes.error || providersRes.error || couriersRes.error || ordersRes.error;
    if (firstError) throw firstError;

    type ProviderRow = {
      id: string;
      kind: DeliveryProviderKind;
      display_name: string | null;
      max_concurrent_orders: number;
      is_active: boolean;
    };
    type OrderRow = {
      driver_id: string;
      status: string;
      settlement_id: string | null;
      total_amount: number;
      collected_amount: number | null;
      subtotal: number;
      discount: number;
    };

    const providerById = new Map<string, ProviderRow>(
      (providersRes.data ?? []).map((p: ProviderRow) => [p.id, p])
    );

    const courierCount = new Map<string, number>();
    for (const c of (couriersRes.data ?? []) as { office_id: string; is_active: boolean }[]) {
      if (!c.is_active) continue;
      courierCount.set(c.office_id, (courierCount.get(c.office_id) ?? 0) + 1);
    }

    const ACTIVE = new Set(["preparing", "ready_for_pickup", "out_for_delivery"]);
    const activeCount = new Map<string, number>();
    const unsettled = new Map<string, number>();
    for (const o of (ordersRes.data ?? []) as OrderRow[]) {
      if (ACTIVE.has(o.status)) {
        activeCount.set(o.driver_id, (activeCount.get(o.driver_id) ?? 0) + 1);
      }
      if (o.status === "delivered" && o.settlement_id === null) {
        // Mirrors the server: collected from the customer minus what was
        // paid over the restaurant counter.
        const collected = o.collected_amount ?? o.total_amount;
        const owed = Number(collected) - (Number(o.subtotal) - Number(o.discount));
        unsettled.set(o.driver_id, (unsettled.get(o.driver_id) ?? 0) + owed);
      }
    }

    return ((profilesRes.data ?? []) as {
      id: string;
      full_name: string | null;
      phone: string | null;
      is_available: boolean;
    }[]).map((p) => {
      const provider = providerById.get(p.id);
      return {
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        is_available: p.is_available,
        kind: provider?.kind ?? null,
        display_name: provider?.display_name ?? null,
        max_concurrent_orders: provider?.max_concurrent_orders ?? null,
        is_active: provider?.is_active ?? null,
        active_orders: activeCount.get(p.id) ?? 0,
        couriers: courierCount.get(p.id) ?? 0,
        unsettled_amount: Math.round((unsettled.get(p.id) ?? 0) * 100) / 100,
      };
    });
  },

  /**
   * Promote/demote an account and set its ceiling. This is the only path
   * that turns a driver into an office — `delivery_providers` is
   * admin-write-only by RLS precisely so an office can't raise its own
   * limit.
   */
  async upsert(input: {
    profileId: string;
    kind: DeliveryProviderKind;
    displayName?: string | null;
    maxConcurrentOrders?: number | null;
    isActive?: boolean;
  }): Promise<void> {
    const { error } = await rpc("rpc_admin_upsert_delivery_provider", {
      p_profile_id: input.profileId,
      p_kind: input.kind,
      p_display_name: input.displayName ?? null,
      // Individuals are pinned to 1 server-side; sending null lets the RPC
      // apply its own default (10) when promoting an office.
      p_max_concurrent_orders:
        input.kind === "office" ? input.maxConcurrentOrders ?? null : 1,
      p_is_active: input.isActive ?? true,
    });
    if (error) throw error;
  },

  async listCouriers(officeId: string): Promise<OfficeCourier[]> {
    const { data, error } = await db()
      .from("office_couriers")
      .select("id, office_id, full_name, phone, is_active, created_at")
      .eq("office_id", officeId)
      .order("is_active", { ascending: false })
      .order("full_name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as OfficeCourier[];
  },

  async listSettlements(providerId: string, limit = 20): Promise<ProviderSettlement[]> {
    const { data, error } = await db()
      .from("provider_settlements")
      .select("*")
      .eq("provider_id", providerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ProviderSettlement[];
  },
};
