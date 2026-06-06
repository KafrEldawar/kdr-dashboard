import { requireSupabase } from "@/lib/supabase/client";
import { createTableService } from "@/services/base-table.service";
import type { QueryParams } from "@/types/service";
import type { Profile, ProfileInsert, ProfileUpdate, UserRole } from "@/types/database";

const baseProfilesService = createTableService({
  table: "profiles",
  defaultSort: "created_at",
  searchColumns: ["full_name", "phone"],
});

export type UserFilters = {
  role?: string;
};

export type CreateTestUserInput = {
  full_name: string;
  email: string;
  phone?: string;
  role: UserRole;
  password: string;
};

export const usersService = {
  ...baseProfilesService,

  async getAll(params: QueryParams<UserFilters> = {}) {
    return baseProfilesService.getAll(params);
  },

  async create(input: ProfileInsert) {
    return baseProfilesService.create(input);
  },

  async update(id: string, input: ProfileUpdate) {
    return baseProfilesService.update(id, input);
  },

  async createTestUser(input: CreateTestUserInput) {
    const supabase = requireSupabase();
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          full_name: input.full_name,
          phone: input.phone,
        },
      },
    });

    if (authError) throw authError;

    if (!authData.user?.id) {
      throw new Error("تم إنشاء طلب التسجيل، لكن Supabase لم يرجع user id.");
    }

    // Profile is auto-created by DB trigger; update the role only.
    return baseProfilesService.update(authData.user.id, {
      role: input.role,
      full_name: input.full_name,
      phone: input.phone ?? null,
    });
  },

  async changeRole(user: Profile, role: UserRole) {
    return baseProfilesService.update(user.id, { role });
  },

  async toggleActive(user: Profile) {
    return baseProfilesService.update(user.id, { is_active: !user.is_active });
  },

  async getRelatedOrders(userId: string) {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("orders")
      .select("id, status, total_amount, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;
    return data ?? [];
  },
};
