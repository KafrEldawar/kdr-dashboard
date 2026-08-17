import { createTableService } from "@/services/base-table.service";
import { requireSupabase } from "@/lib/supabase/client";
import type { MenuItemVariant } from "@/types/database";

// Priced choices of a menu item — sizes, crusts, single/double (migration 074).
// `menu_items.price` is kept equal to the default variant's price by the
// `trg_sync_menu_item_default_price` trigger, so the editor never writes
// the item price itself.
export const menuVariantsService = {
  ...createTableService({
    table: "menu_item_variants",
    defaultSort: "sort_order",
    searchColumns: ["name_ar", "name_en"],
  }),

  /// Variants of one item, in menu order. Not paginated — six sizes is the
  /// realistic ceiling and the editor wants them all at once.
  async listForItem(menuItemId: string): Promise<MenuItemVariant[]> {
    const { data, error } = await requireSupabase()
      .from("menu_item_variants")
      .select("*")
      .eq("menu_item_id", menuItemId)
      .order("sort_order", { ascending: true })
      .order("price", { ascending: true });

    if (error) throw error;
    return (data ?? []) as MenuItemVariant[];
  },

  /// How many variants each of these items has, keyed by item id.
  /// One round-trip for the whole page instead of a query per row.
  async countsForItems(itemIds: string[]): Promise<Record<string, number>> {
    if (itemIds.length === 0) return {};

    const { data, error } = await requireSupabase()
      .from("menu_item_variants")
      .select("menu_item_id")
      .in("menu_item_id", itemIds);

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as { menu_item_id: string }[]) {
      counts[row.menu_item_id] = (counts[row.menu_item_id] ?? 0) + 1;
    }
    return counts;
  },

  /// Promotes one variant to default.
  ///
  /// `uq_menu_item_variants_one_default` is a partial unique index, so the
  /// current default MUST be cleared before the new one is set — doing it
  /// in the other order trips the constraint. There is no transaction
  /// available from the browser client, so the clear is written first and
  /// the failure mode is "no default", which the trigger recovers from by
  /// falling back to the cheapest variant.
  async setDefault(menuItemId: string, variantId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error: clearError } = await supabase
      .from("menu_item_variants")
      .update({ is_default: false })
      .eq("menu_item_id", menuItemId)
      .eq("is_default", true);

    if (clearError) throw clearError;

    const { error: setError } = await supabase
      .from("menu_item_variants")
      .update({ is_default: true })
      .eq("id", variantId);

    if (setError) throw setError;
  },
};
