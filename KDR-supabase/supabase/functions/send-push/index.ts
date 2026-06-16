/**
 * send-push Edge Function  (v2)
 *
 * Two operation modes:
 *  1. Campaign dispatch  — body: { campaign_id }
 *  2. Order event        — body: { event: "new_order"|"status_change", order_id }
 *
 * Env vars required:
 *   FIREBASE_SERVICE_ACCOUNT_KEY  — full service-account JSON (single-line string)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    if (body.campaign_id) return await handleCampaign(supabase, body.campaign_id);
    if (body.event && body.order_id) return await handleOrderEvent(supabase, body.event, body.order_id);

    return json({ error: "Provide campaign_id or { event, order_id }" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

// ── Campaign dispatch ──────────────────────────────────────────
async function handleCampaign(supabase: ReturnType<typeof createClient>, campaignId: string) {
  const { data: campaign, error } = await supabase
    .from("notification_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (error || !campaign) return json({ error: "Campaign not found" }, 404);
  if (campaign.status === "sent") return json({ error: "Campaign already sent" }, 400);

  await supabase.from("notification_campaigns").update({ status: "sending" }).eq("id", campaignId);

  const tokens = await getTargetTokens(supabase, campaign.target_type, campaign.target_filter);

  if (tokens.length === 0) {
    await supabase.from("notification_campaigns").update({
      status: "sent", sent_count: 0, sent_at: new Date().toISOString(),
    }).eq("id", campaignId);
    return json({ success: true, sent_count: 0 });
  }

  const title = campaign.title_ar;
  const body  = campaign.body_ar;

  const { sent, failed } = await sendFcmBatch(
    supabase,
    tokens.map((t: { token: string }) => t.token),
    title, body,
    { image: campaign.image_url, data: campaign.extra_data }
  );

  // Store in-app notifications for all targeted users
  const userIds = [...new Set(tokens.map((t: { user_id: string }) => t.user_id))];
  if (userIds.length > 0) {
    await supabase.from("user_notifications").insert(
      userIds.map((uid: string) => ({
        user_id: uid,
        title,
        body,
        image_url: campaign.image_url ?? null,
        extra_data: campaign.extra_data ?? null,
        campaign_id: campaign.id,
      }))
    );
  }

  await supabase.from("notification_campaigns").update({
    status: "sent",
    sent_count: sent,
    failed_count: failed,
    sent_at: new Date().toISOString(),
    error_log: failed > 0 ? `${failed} tokens failed` : null,
  }).eq("id", campaignId);

  return json({ success: true, sent_count: sent, failed_count: failed });
}

// ── Order event notifications ─────────────────────────────────
async function handleOrderEvent(
  supabase: ReturnType<typeof createClient>,
  event: string,
  orderId: string
) {
  console.log(`[send-push] event=${event} order_id=${orderId}`);

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, status, restaurant_id, user_id, total_amount, order_type, driver_id, estimated_preparation_minutes, rejection_reason")
    .eq("id", orderId)
    .single();

  if (orderErr) console.error("[send-push] order fetch error:", orderErr.message);
  if (!order) return json({ error: "Order not found" }, 404);

  console.log(`[send-push] order: restaurant_id=${order.restaurant_id} user_id=${order.user_id} status=${order.status}`);

  if (event === "new_order") {
    const { data: owner, error: ownerErr } = await supabase
      .from("restaurant_owners")
      .select("user_id")
      .eq("restaurant_id", order.restaurant_id)
      .single();

    if (ownerErr) console.error("[send-push] owner fetch error:", ownerErr.message);
    console.log(`[send-push] owner: ${owner ? "found=" + owner.user_id : "NOT FOUND"}`);

    if (owner) {
      const tokens = await getUserTokens(supabase, owner.user_id);
      console.log(`[send-push] owner tokens: ${tokens.length}`);
      const title = "طلب جديد";
      const body = `لديك طلب جديد بقيمة ${order.total_amount}`;
      const { sent, failed } = await sendFcmBatch(supabase, tokens, title, body, { data: { order_id: orderId, event }, channelId: "restaurant_channel" });
      console.log(`[send-push] FCM new_order: sent=${sent} failed=${failed}`);
      await supabase.from("user_notifications").insert({
        user_id: owner.user_id, title, body,
        extra_data: { order_id: orderId, event },
      });
    }
  } else if (event === "status_change") {
    const statusLabels: Record<string, string> = {
      preparing:             "تم قبول طلبك وجاري تحضيره",
      ready_for_pickup:      order.order_type === "pickup"
                               ? "طلبك جاهز للاستلام من المطعم"
                               : "طلبك جاهز وفي انتظار المندوب",
      out_for_delivery:      "طلبك في الطريق إليك",
      delivered:             "تم تسليم طلبك",
      picked_up_by_customer: "تم استلام طلبك، بالهناء والشفاء",
      rejected:              order.rejection_reason
                               ? `عذراً، تم رفض طلبك: ${order.rejection_reason}`
                               : "عذراً، تم رفض طلبك",
      cancelled:             "تم إلغاء طلبك",
    };
    const label = statusLabels[order.status] ?? `حالة طلبك: ${order.status}`;
    const tokens = await getUserTokens(supabase, order.user_id);
    console.log(`[send-push] customer tokens: ${tokens.length}`);
    const { sent, failed } = await sendFcmBatch(supabase, tokens, "تحديث الطلب", label, {
      data: { order_id: orderId, event, status: order.status },
      channelId: "customer_channel",
    });
    console.log(`[send-push] FCM status_change: sent=${sent} failed=${failed}`);
    await supabase.from("user_notifications").insert({
      user_id: order.user_id, title: "تحديث الطلب", body: label,
      extra_data: { order_id: orderId, status: order.status },
    });
  } else if (event === "order_available") {
    // New delivery order accepted by the restaurant → notify every driver
    const driverTokens = await getTargetTokens(supabase, "custom", { role: "driver" });
    console.log(`[send-push] driver tokens: ${driverTokens.length}`);
    const title = "طلب توصيل جديد";
    const body = `طلب جديد متاح للاستلام بقيمة ${order.total_amount}`;
    const { sent, failed } = await sendFcmBatch(
      supabase,
      driverTokens.map((t) => t.token),
      title, body,
      { data: { order_id: orderId, event }, channelId: "delivery_channel" }
    );
    console.log(`[send-push] FCM order_available: sent=${sent} failed=${failed}`);
    const driverIds = [...new Set(driverTokens.map((t) => t.user_id))];
    if (driverIds.length > 0) {
      await supabase.from("user_notifications").insert(
        driverIds.map((uid) => ({
          user_id: uid, title, body,
          extra_data: { order_id: orderId, event },
        }))
      );
    }
  } else if (event === "order_ready") {
    // Order ready at the restaurant → notify the assigned driver
    if (!order.driver_id) return json({ error: "Order has no assigned driver" }, 400);
    const tokens = await getUserTokens(supabase, order.driver_id);
    console.log(`[send-push] assigned driver tokens: ${tokens.length}`);
    const title = "الطلب جاهز للاستلام";
    const body = "الطلب جاهز، يمكنك استلامه من المطعم الآن";
    const { sent, failed } = await sendFcmBatch(supabase, tokens, title, body, {
      data: { order_id: orderId, event },
      channelId: "delivery_channel",
    });
    console.log(`[send-push] FCM order_ready: sent=${sent} failed=${failed}`);
    await supabase.from("user_notifications").insert({
      user_id: order.driver_id, title, body,
      extra_data: { order_id: orderId, event },
    });
  } else if (event === "order_cancelled_driver") {
    // Delivery order cancelled → notify the assigned driver, or all drivers if unclaimed
    const title = "تم إلغاء الطلب";
    const body = "تم إلغاء طلب التوصيل من المطعم";
    if (order.driver_id) {
      const tokens = await getUserTokens(supabase, order.driver_id);
      const { sent, failed } = await sendFcmBatch(supabase, tokens, title, body, {
        data: { order_id: orderId, event },
        channelId: "delivery_channel",
      });
      console.log(`[send-push] FCM order_cancelled_driver(assigned): sent=${sent} failed=${failed}`);
      await supabase.from("user_notifications").insert({
        user_id: order.driver_id, title, body,
        extra_data: { order_id: orderId, event },
      });
    } else {
      const driverTokens = await getTargetTokens(supabase, "custom", { role: "driver" });
      const { sent, failed } = await sendFcmBatch(
        supabase,
        driverTokens.map((t) => t.token),
        title, body,
        { data: { order_id: orderId, event }, channelId: "delivery_channel" }
      );
      console.log(`[send-push] FCM order_cancelled_driver(pool): sent=${sent} failed=${failed}`);
    }
  }

  return json({ success: true });
}

// ── FCM helpers ───────────────────────────────────────────────
async function getFcmAccessToken(): Promise<string> {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY not set");

  const sa = JSON.parse(raw);
  const keyData = pemToBuffer(sa.private_key as string);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: getNumericDate(0),
      exp: getNumericDate(3600),
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    },
    cryptoKey
  );

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await resp.json();
  return tokenData.access_token as string;
}

async function sendFcmBatch(
  supabase: ReturnType<typeof createClient>,
  tokens: string[],
  title: string,
  body: string,
  opts: { image?: string; data?: Record<string, unknown>; channelId?: string } = {}
): Promise<{ sent: number; failed: number }> {
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken();
  } catch {
    return { sent: 0, failed: 0 }; // FCM not configured — no-op in dev
  }

  const sa = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY")!);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  let sent = 0, failed = 0;
  const CHUNK = 500;
  for (let i = 0; i < tokens.length; i += CHUNK) {
    await Promise.allSettled(
      tokens.slice(i, i + CHUNK).map(async (token) => {
        const payload = {
          message: {
            token,
            notification: { title, body, ...(opts.image ? { image: opts.image } : {}) },
            android: {
              priority: "high",
              // Must match a channel the app actually creates (customer_channel /
              // restaurant_channel / delivery_channel). The legacy
              // "high_importance_channel" is deleted on the device, so targeting
              // it drops the notification on Android 8+.
              notification: {
                channel_id: opts.channelId ?? "customer_channel",
                sound: "default",
              },
            },
            apns: {
              headers: { "apns-priority": "10" },
              payload: { aps: { sound: "default", badge: 1, "content-available": 1 } },
            },
            data: opts.data
              ? Object.fromEntries(Object.entries(opts.data).map(([k, v]) => [k, String(v)]))
              : undefined,
          },
        };
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          sent++;
        } else {
          const errBody = await res.json().catch(() => ({}));
          console.error(`[FCM] token=${token.slice(0, 20)}... status=${res.status} err=${JSON.stringify(errBody)}`);
          // Auto-deactivate permanently invalid tokens so they are never retried
          const fcmError = errBody?.error?.details?.find(
            (d: { errorCode?: string }) => d.errorCode === "UNREGISTERED" || d.errorCode === "THIRD_PARTY_AUTH_ERROR"
          );
          if (fcmError) {
            await supabase.from("device_tokens").update({ is_active: false }).eq("token", token);
            console.log(`[FCM] deactivated stale token: ${token.slice(0, 20)}...`);
          }
          failed++;
        }
      })
    );
  }

  return { sent, failed };
}

async function getTargetTokens(
  supabase: ReturnType<typeof createClient>,
  targetType: string,
  filter: Record<string, unknown> | null
): Promise<{ token: string; user_id: string }[]> {
  let query = supabase
    .from("device_tokens")
    .select("token, user_id, profiles!inner(role)")
    .eq("is_active", true);

  switch (targetType) {
    case "all_customers":    query = query.eq("profiles.role", "customer");   break;
    case "all_restaurants":  query = query.eq("profiles.role", "restaurant"); break;
    case "platform_android": query = query.eq("platform", "android");         break;
    case "platform_ios":     query = query.eq("platform", "ios");             break;
    case "custom":
      if (filter?.platform)  query = query.eq("platform", filter.platform as string);
      if (filter?.role)      query = query.eq("profiles.role", filter.role as string);
      if (filter?.user_ids)  query = query.in("user_id", filter.user_ids as string[]);
      break;
  }

  const { data } = await query;
  return (data ?? []) as { token: string; user_id: string }[];
}

async function getUserTokens(supabase: ReturnType<typeof createClient>, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId)
    .eq("is_active", true);
  return (data ?? []).map((d: { token: string }) => d.token);
}

function pemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
