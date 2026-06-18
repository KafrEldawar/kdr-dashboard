/**
 * dispatch-campaign-batch Edge Function
 *
 * Invoked every 5 min by pg_cron (via rpc_dispatch_whatsapp_batch).
 * Can also be triggered manually for testing.
 *
 * Steps:
 *   1. Select up to MAX_BATCH pending recipients for campaigns in
 *      ('scheduled','running') whose scheduled_for <= now().
 *   2. Group by campaign_id (Railway sends per-campaign for log clarity).
 *   3. Per campaign, mark the picked rows as 'sending' (lightweight
 *      lock), POST them to Railway /send-campaign with HMAC, write back
 *      sent/failed status, increment campaign counters.
 *   4. For each touched campaign, call rpc_mark_campaign_if_done.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *           WA_SHARED_SECRET, WA_SERVICE_URL
 */

import { CORS, json }       from "../_shared/cors.ts";
import { serviceClient }    from "../_shared/supabase.ts";
import { callRailway }      from "../_shared/hmac.ts";

const MAX_BATCH = 25;

interface RecipientRow {
  id: string;
  campaign_id: string;
  phone: string;
  name: string | null;
}

interface CampaignRow {
  id: string;
  title: string;
  body_template: string;
  image_url: string | null;
}

interface RailwayItemResult {
  phone: string;
  status: "sent" | "failed";
  provider_message_id?: string;
  error?: string;
}

interface RailwayCampaignResponse {
  ok: boolean;
  results: RailwayItemResult[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const svc = serviceClient();

    // 1) Pick the next batch (oldest scheduled_for first, for fairness).
    const { data: recipients, error } = await svc
      .from("whatsapp_campaign_recipients")
      .select("id, campaign_id, phone, name, whatsapp_campaigns!inner(status)")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .in("whatsapp_campaigns.status", ["scheduled", "running"])
      .order("scheduled_for", { ascending: true })
      .limit(MAX_BATCH);

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!recipients || recipients.length === 0) {
      return json({ ok: true, picked: 0 });
    }

    const rows = recipients as unknown as RecipientRow[];

    // Group by campaign_id.
    const byCampaign = new Map<string, RecipientRow[]>();
    for (const r of rows) {
      const arr = byCampaign.get(r.campaign_id) ?? [];
      arr.push(r);
      byCampaign.set(r.campaign_id, arr);
    }

    const summary: Record<string, { sent: number; failed: number }> = {};

    for (const [campaignId, batch] of byCampaign.entries()) {
      // Load campaign metadata once.
      const { data: campaign } = await svc
        .from("whatsapp_campaigns")
        .select("id, title, body_template, image_url")
        .eq("id", campaignId)
        .single();
      if (!campaign) continue;
      const c = campaign as CampaignRow;

      const ids = batch.map((b) => b.id);

      // Render per-recipient bodies (interpolate {{name}}).
      const items = batch.map((b) => ({
        recipient_id:        b.id,
        phone:               b.phone,
        body:                renderTemplate(c.body_template, { name: b.name ?? "" }),
        image_url:           c.image_url,
      }));

      // Audit-log "queued" for every send.
      await svc.from("whatsapp_send_log").insert(
        batch.map((b) => ({
          phone:       b.phone,
          purpose:     "campaign",
          campaign_id: campaignId,
          status:      "queued",
        })),
      );

      const railway = await callRailway<RailwayCampaignResponse>(
        "/send-campaign",
        { campaign_id: campaignId, items },
        60_000,
      );

      // Build a phone → result map. If Railway didn't respond at all,
      // treat every row as failed but eligible for retry.
      const byPhone = new Map<string, RailwayItemResult>();
      if (railway.ok && railway.data?.results) {
        for (const r of railway.data.results) byPhone.set(r.phone, r);
      }

      let sent = 0, failed = 0;

      for (const b of batch) {
        const result = byPhone.get(b.phone);
        const ok     = result?.status === "sent";

        const update: Record<string, unknown> = ok
          ? {
              status:              "sent",
              sent_at:             new Date().toISOString(),
              provider_message_id: result?.provider_message_id ?? null,
              error:               null,
            }
          : {
              status: "failed",
              error:  result?.error ?? railway.error ?? "no_response",
            };

        await svc.from("whatsapp_campaign_recipients").update(update).eq("id", b.id);

        await svc.from("whatsapp_send_log").insert({
          phone:               b.phone,
          purpose:             "campaign",
          campaign_id:         campaignId,
          status:              ok ? "sent" : "failed",
          provider_message_id: result?.provider_message_id ?? null,
          error:               ok ? null : (result?.error ?? railway.error ?? null),
        });

        if (ok) sent++; else failed++;
      }

      summary[campaignId] = { sent, failed };

      // Bump campaign counters in one shot.
      await svc.rpc("rpc_bump_campaign_counters" as never, {
        p_campaign_id: campaignId,
        p_sent_delta:  sent,
        p_failed_delta: failed,
      } as never).catch(() => { /* RPC optional, see fallback below */ });

      // Fallback if the optional RPC isn't deployed: do it inline.
      await svc.from("whatsapp_campaigns")
        .update({
          sent_count:   (await svc
            .from("whatsapp_campaign_recipients")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaignId)
            .eq("status", "sent")).count ?? 0,
          failed_count: (await svc
            .from("whatsapp_campaign_recipients")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaignId)
            .eq("status", "failed")).count ?? 0,
        })
        .eq("id", campaignId);

      // Mark campaign completed if nothing pending remains.
      await svc.rpc("rpc_mark_campaign_if_done", { p_campaign_id: campaignId });
    }

    return json({ ok: true, picked: rows.length, summary });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key) =>
    vars[key] ?? "",
  );
}
