import { requireSupabase } from "@/lib/supabase/client";
import type { BranchPhone } from "@/types/database";

export const branchPhonesService = {
  async getByBranchId(branchId: string): Promise<BranchPhone[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("branch_phones")
      .select("*")
      .eq("branch_id", branchId);
    if (error) throw error;
    return (data ?? []) as BranchPhone[];
  },

  async syncPhones(branchId: string, phones: string[]): Promise<void> {
    const supabase = requireSupabase();
    const { error: deleteError } = await supabase
      .from("branch_phones")
      .delete()
      .eq("branch_id", branchId);
    if (deleteError) throw deleteError;
    if (phones.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = supabase.from("branch_phones") as any;
    const { error: insertError } = await table.insert(
      phones.map((phone) => ({ branch_id: branchId, phone })),
    );
    if (insertError) throw insertError;
  },

  async createPhone(branchId: string, phone: string): Promise<BranchPhone> {
    const supabase = requireSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = supabase.from("branch_phones") as any;
    const { data, error } = await table
      .insert({ branch_id: branchId, phone })
      .select()
      .single();
    if (error) throw error;
    return data as BranchPhone;
  },
};
