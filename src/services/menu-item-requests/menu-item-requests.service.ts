import { requireSupabase } from "@/lib/supabase/client";

export type MenuItemRequestStatus = "pending" | "approved" | "rejected";

export type MenuItemRequest = {
  id: string;
  action: "create" | "update";
  status: MenuItemRequestStatus;
  proposed_data: Record<string, unknown>;
  owner_note: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  menu_item_id: string | null;
  restaurant_name_ar: string;
  restaurant_name_en: string | null;
  current_item: {
    name_ar: string;
    name_en: string;
    price: number;
  } | null;
};

export type MenuItemRequestsResponse = {
  data: MenuItemRequest[];
  meta: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
};

function rpc(name: string, args?: Record<string, unknown>) {
  const supabase = requireSupabase();
  return (supabase as unknown as { rpc: (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> })
    .rpc(name, args);
}

async function getRequests(params?: {
  status?: MenuItemRequestStatus | "all";
  page?: number;
  pageSize?: number;
}): Promise<MenuItemRequestsResponse> {
  const { data, error } = await rpc("rpc_admin_get_menu_item_requests", {
    p_status: params?.status ?? "pending",
    p_page: params?.page ?? 1,
    p_page_size: params?.pageSize ?? 20,
  });
  if (error) throw new Error(error.message);
  return data as MenuItemRequestsResponse;
}

async function reviewRequest(params: {
  requestId: string;
  status: "approved" | "rejected";
  adminNote?: string;
}): Promise<void> {
  const { data, error } = await rpc("rpc_admin_review_menu_item_request", {
    p_request_id: params.requestId,
    p_status: params.status,
    p_admin_note: params.adminNote ?? null,
  });
  if (error) throw new Error(error.message);
  const result = data as { error?: string };
  if (result?.error) throw new Error(result.error);
}

export const menuItemRequestsService = { getRequests, reviewRequest };
