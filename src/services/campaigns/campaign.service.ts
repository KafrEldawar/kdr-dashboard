/**
 * WhatsApp campaigns service.
 *
 * Hits the new whatsapp_campaigns / whatsapp_campaign_recipients tables
 * and the rpc_admin_* RPCs from migration 033. We hand-roll this instead
 * of using createTableService because the generated database.ts hasn't
 * been regenerated for these tables yet.
 */

import { requireSupabase } from "@/lib/supabase/client";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type CampaignTargetType = "all_customers" | "role_filter" | "custom_list";

export type WhatsappCampaign = {
  id: string;
  title: string;
  body_template: string;
  image_url: string | null;
  target_type: CampaignTargetType;
  target_filter: Record<string, unknown>;
  daily_cap: number;
  schedule_start_at: string;
  status: CampaignStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RecipientStatus = "pending" | "sent" | "failed" | "skipped";

export type CampaignRecipient = {
  id: string;
  campaign_id: string;
  phone: string;
  name: string | null;
  status: RecipientStatus;
  scheduled_for: string;
  sent_at: string | null;
  error: string | null;
  provider_message_id: string | null;
  created_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return requireSupabase();
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const message =
      (res.error as { message?: string })?.message ??
      "حصل خطأ غير متوقع";
    throw new Error(message);
  }
  return res.data as T;
}

function unwrapRpc<T>(res: { data: unknown; error: unknown }): T {
  if (res.error) {
    throw new Error((res.error as { message?: string })?.message ?? "خطأ في RPC");
  }
  // RPCs may return { error: 'message' } as data on logic errors.
  const data = res.data as Record<string, unknown> | T;
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export const campaignsService = {
  async list(params: {
    status?: CampaignStatus | "all";
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}): Promise<{ data: WhatsappCampaign[]; count: number }> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 30;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = db()
      .from("whatsapp_campaigns")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (params.status && params.status !== "all") {
      query = query.eq("status", params.status);
    }
    if (params.search) {
      query = query.ilike("title", `%${params.search.replaceAll("%", "\\%")}%`);
    }

    const res = await query;
    if (res.error) throw res.error;
    return { data: (res.data ?? []) as WhatsappCampaign[], count: res.count ?? 0 };
  },

  async getById(id: string): Promise<WhatsappCampaign> {
    return unwrap(
      await db().from("whatsapp_campaigns").select("*").eq("id", id).single()
    );
  },

  async listRecipients(
    campaignId: string,
    params: { status?: RecipientStatus | "all"; page?: number; pageSize?: number } = {}
  ): Promise<{ data: CampaignRecipient[]; count: number }> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = db()
      .from("whatsapp_campaign_recipients")
      .select("*", { count: "exact" })
      .eq("campaign_id", campaignId)
      .order("scheduled_for", { ascending: true })
      .range(from, to);

    if (params.status && params.status !== "all") {
      query = query.eq("status", params.status);
    }

    const res = await query;
    if (res.error) throw res.error;
    return { data: (res.data ?? []) as CampaignRecipient[], count: res.count ?? 0 };
  },

  async create(params: {
    title: string;
    bodyTemplate: string;
    targetType: CampaignTargetType;
    targetFilter?: Record<string, unknown>;
    imageUrl?: string;
    dailyCap: number;
    scheduleStartAt: string;
  }): Promise<{ campaign_id: string }> {
    return unwrapRpc<{ campaign_id: string }>(
      await db().rpc("rpc_admin_create_whatsapp_campaign", {
        p_title: params.title,
        p_body_template: params.bodyTemplate,
        p_target_type: params.targetType,
        p_target_filter: params.targetFilter ?? {},
        p_image_url: params.imageUrl ?? null,
        p_daily_cap: params.dailyCap,
        p_schedule_start_at: params.scheduleStartAt,
      })
    );
  },

  async attachRecipients(params: {
    campaignId: string;
    customPhones?: string[];
    customNames?: string[];
  }): Promise<{ inserted: number; total: number; status: string }> {
    return unwrapRpc<{ inserted: number; total: number; status: string }>(
      await db().rpc("rpc_admin_attach_campaign_recipients", {
        p_campaign_id: params.campaignId,
        p_custom_phones: params.customPhones ?? null,
        p_custom_names: params.customNames ?? null,
      })
    );
  },

  async pause(campaignId: string): Promise<void> {
    unwrapRpc(
      await db().rpc("rpc_admin_pause_campaign", { p_campaign_id: campaignId })
    );
  },

  async resume(campaignId: string): Promise<void> {
    unwrapRpc(
      await db().rpc("rpc_admin_resume_campaign", { p_campaign_id: campaignId })
    );
  },

  async retryFailed(campaignId: string): Promise<{ requeued: number }> {
    return unwrapRpc<{ requeued: number }>(
      await db().rpc("rpc_retry_failed_recipients", { p_campaign_id: campaignId })
    );
  },

  async dispatchNow(campaignId: string): Promise<{ requeued: number; status: string }> {
    return unwrapRpc<{ requeued: number; status: string }>(
      await db().rpc("rpc_admin_dispatch_now", { p_campaign_id: campaignId })
    );
  },

  async delete(campaignId: string): Promise<void> {
    const res = await db().from("whatsapp_campaigns").delete().eq("id", campaignId);
    if (res.error) throw res.error;
  },
};
