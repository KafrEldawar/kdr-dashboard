import { requireSupabase } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";

export type AdminStats = {
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

export type AdminUser = {
  id: string;
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  restaurant: { id: string; name_ar: string; name_en: string } | null;
};

export type AdminOrder = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  restaurant: { id: string; name_ar: string; name_en: string };
  customer: { id: string; full_name: string | null; phone: string | null };
};

export type RpcListResult<T> = {
  data: T[];
  meta: { total: number; page: number; page_size: number; total_pages: number };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpc(name: string, args?: Record<string, unknown>): Promise<{ data: any; error: any }> {
  const supabase = requireSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).rpc(name, args);
}

export const adminService = {
  async getStats(): Promise<AdminStats> {
    const { data, error } = await rpc("rpc_admin_get_stats");
    if (error) throw error;
    return data as AdminStats;
  },

  async listUsers(params: {
    role?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RpcListResult<AdminUser>> {
    const { data, error } = await rpc("rpc_admin_list_users", {
      p_role: params.role ?? null,
      p_search: params.search ?? null,
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 20,
    });
    if (error) throw error;
    return data as RpcListResult<AdminUser>;
  },

  async updateUser(params: {
    userId: string;
    role?: string;
    isActive?: boolean;
    fullName?: string;
    phone?: string;
  }) {
    const { data, error } = await rpc("rpc_admin_update_user", {
      p_user_id: params.userId,
      p_role: params.role ?? null,
      p_is_active: params.isActive ?? null,
      p_full_name: params.fullName ?? null,
      p_phone: params.phone ?? null,
    });
    if (error) throw error;
    return data;
  },

  async listOrders(params: {
    status?: string;
    restaurantId?: string;
    userId?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RpcListResult<AdminOrder>> {
    const { data, error } = await rpc("rpc_admin_list_orders", {
      p_status: params.status ?? null,
      p_restaurant_id: params.restaurantId ?? null,
      p_user_id: params.userId ?? null,
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 20,
    });
    if (error) throw error;
    return data as RpcListResult<AdminOrder>;
  },

  async manageCategory(params: {
    action: "create" | "update" | "delete";
    id?: string;
    nameAr?: string;
    nameEn?: string;
    imageUrl?: string;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    const { data, error } = await rpc("rpc_admin_manage_category", {
      p_action: params.action,
      p_id: params.id ?? null,
      p_name_ar: params.nameAr ?? null,
      p_name_en: params.nameEn ?? null,
      p_image_url: params.imageUrl ?? null,
      p_sort_order: params.sortOrder ?? null,
      p_is_active: params.isActive ?? null,
    });
    if (error) throw error;
    return data;
  },

  async createRestaurant(params: {
    nameAr: string;
    nameEn: string;
    descriptionAr?: string;
    descriptionEn?: string;
    logoUrl?: string;
    coverUrl?: string;
    deliveryFee?: number;
    minOrderAmount?: number;
    acceptsOnline?: boolean;
    categoryIds?: string[];
  }) {
    const { data, error } = await rpc("rpc_admin_create_restaurant", {
      p_name_ar: params.nameAr,
      p_name_en: params.nameEn,
      p_description_ar: params.descriptionAr ?? null,
      p_description_en: params.descriptionEn ?? null,
      p_logo_url: params.logoUrl ?? null,
      p_cover_url: params.coverUrl ?? null,
      p_delivery_fee: params.deliveryFee ?? 15,
      p_min_order_amount: params.minOrderAmount ?? 0,
      p_accepts_online: params.acceptsOnline ?? true,
      p_category_ids: params.categoryIds ?? null,
    });
    if (error) throw error;
    return data;
  },

  async linkOwnerToRestaurant(userId: string, restaurantId: string) {
    const { data, error } = await rpc("rpc_admin_link_owner_to_restaurant", {
      p_user_id: userId,
      p_restaurant_id: restaurantId,
    });
    if (error) throw error;
    return data;
  },

  async getRatings(params: {
    restaurantId?: string;
    rating?: number;
    page?: number;
    pageSize?: number;
  } = {}) {
    const { data, error } = await rpc("rpc_admin_get_ratings", {
      p_restaurant_id: params.restaurantId ?? null,
      p_rating: params.rating ?? null,
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 20,
    });
    if (error) throw error;
    return data as RpcListResult<{
      order_id: string;
      restaurant_id: string;
      restaurant_name: string;
      user_id: string;
      user_name: string | null;
      rating: number;
      review: string | null;
      created_at: string;
    }>;
  },

  async sendNotification(params: {
    titleAr: string;
    bodyAr: string;
    titleEn?: string;
    bodyEn?: string;
    imageUrl?: string;
    targetType?: string;
    data?: Record<string, unknown>;
  }) {
    const { data, error } = await rpc("rpc_admin_send_notification", {
      p_title_ar: params.titleAr,
      p_body_ar: params.bodyAr,
      p_title_en: params.titleEn ?? null,
      p_body_en: params.bodyEn ?? null,
      p_image_url: params.imageUrl ?? null,
      p_target_type: params.targetType ?? "all_customers",
      p_data: params.data ?? null,
    });
    if (error) throw error;
    return data;
  },

  async listCampaigns(params: {
    targetType?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RpcListResult<NotificationCampaign>> {
    const { data, error } = await rpc("rpc_admin_list_campaigns", {
      p_target_type: params.targetType ?? null,
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 20,
    });
    if (error) throw error;
    return data as RpcListResult<NotificationCampaign>;
  },

  async listAuditLogs(params: {
    tableName?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RpcListResult<AuditLog>> {
    const { data, error } = await rpc("rpc_admin_list_audit_logs", {
      p_table_name: params.tableName ?? null,
      p_action: params.action ?? null,
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 50,
    });
    if (error) throw error;
    return data as RpcListResult<AuditLog>;
  },

  async listFavorites(params: {
    userId?: string;
    restaurantId?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RpcListResult<FavoriteRow>> {
    const { data, error } = await rpc("rpc_admin_list_favorites", {
      p_user_id: params.userId ?? null,
      p_restaurant_id: params.restaurantId ?? null,
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 20,
    });
    if (error) throw error;
    return data as RpcListResult<FavoriteRow>;
  },

  async listAddresses(params: {
    userId?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<RpcListResult<AddressRow>> {
    const { data, error } = await rpc("rpc_admin_list_addresses", {
      p_user_id: params.userId ?? null,
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 20,
    });
    if (error) throw error;
    return data as RpcListResult<AddressRow>;
  },

  async getOrderHistory(orderId: string): Promise<OrderHistoryRow[]> {
    const { data, error } = await rpc("rpc_admin_get_order_history", {
      p_order_id: orderId,
    });
    if (error) throw error;
    return (data ?? []) as OrderHistoryRow[];
  },

  async manageWorkingHours(branchId: string, hours: WorkingHourInput[]) {
    const { data, error } = await rpc("rpc_admin_manage_working_hours", {
      p_branch_id: branchId,
      p_hours: hours,
    });
    if (error) throw error;
    return data;
  },

  async getWorkingHours(branchId: string) {
    const { data, error } = await rpc("rpc_admin_get_working_hours", {
      p_branch_id: branchId,
    });
    if (error) throw error;
    return (data ?? []) as WorkingHourRow[];
  },

  async manageMenuOption(params: {
    action: "create_option" | "update_option" | "delete_option" | "create_choice" | "update_choice" | "delete_choice";
    id?: string;
    menuItemId?: string;
    optionId?: string;
    nameAr?: string;
    nameEn?: string;
    isRequired?: boolean;
    allowMultiple?: boolean;
    priceExtra?: number;
    isAvailable?: boolean;
    sortOrder?: number;
  }) {
    const { data, error } = await rpc("rpc_admin_manage_menu_option", {
      p_action:          params.action,
      p_id:              params.id ?? null,
      p_menu_item_id:    params.menuItemId ?? null,
      p_option_id:       params.optionId ?? null,
      p_name_ar:         params.nameAr ?? null,
      p_name_en:         params.nameEn ?? null,
      p_is_required:     params.isRequired ?? null,
      p_allow_multiple:  params.allowMultiple ?? null,
      p_price_extra:     params.priceExtra ?? null,
      p_is_available:    params.isAvailable ?? null,
      p_sort_order:      params.sortOrder ?? null,
    });
    if (error) throw error;
    return data;
  },
};

export type FavoriteRow = {
  user_id: string;
  restaurant_id: string;
  created_at: string;
  user_name: string | null;
  restaurant_name_ar: string;
  restaurant_name_en: string;
};

export type AddressRow = {
  id: string;
  user_id: string;
  label: string;
  address_ar: string;
  address_en: string | null;
  location_url: string | null;
  is_default: boolean;
  created_at: string;
  user_name: string | null;
  user_phone: string | null;
};

export type OrderHistoryRow = {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
  changed_by: { id: string; full_name: string | null } | null;
};

export type WorkingHourInput = {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
};

export type WorkingHourRow = WorkingHourInput & {
  id: string;
  branch_id: string;
  created_at: string;
  updated_at: string;
};

export type NotificationCampaign = {
  id: string;
  title_ar: string;
  title_en: string | null;
  target_type: string;
  target_count: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at: string;
  sent_at: string | null;
  sent_by: { id: string; full_name: string | null };
};

export type AuditLog = {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  table_name: string;
  record_id: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};
