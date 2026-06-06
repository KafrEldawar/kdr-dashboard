import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Maps the `type` param → bucket + folder prefix
const BUCKET_CONFIG: Record<string, { bucket: string; prefix: string }> = {
  restaurant_logo:  { bucket: "restaurant-media",    prefix: "logos"   },
  restaurant_cover: { bucket: "restaurant-media",    prefix: "covers"  },
  menu_item:        { bucket: "restaurant-media",    prefix: "menu"    },
  gallery:          { bucket: "restaurant-media",    prefix: "gallery" },
  category:         { bucket: "category-images",     prefix: ""        },
  offer:            { bucket: "offer-images",         prefix: ""        },
  notification:     { bucket: "notification-images", prefix: ""        },
  avatar:           { bucket: "restaurant-media",    prefix: "avatars" },
};

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Parse multipart form ──────────────────────────────────
    const form = await req.formData();
    const file      = form.get("file") as File | null;
    const imageType = (form.get("type") as string | null) ?? "";
    const entityId  = form.get("entity_id") as string | null;

    if (!file) return json({ error: "No file provided" }, 400);

    const cfg = BUCKET_CONFIG[imageType];
    if (!cfg) {
      return json({
        error: `Invalid type. Valid values: ${Object.keys(BUCKET_CONFIG).join(", ")}`,
      }, 400);
    }

    if (!ALLOWED_MIME.has(file.type)) {
      return json({ error: "Invalid file type. Allowed: jpeg, png, webp, gif" }, 400);
    }

    if (file.size > MAX_BYTES) {
      return json({ error: "File too large. Maximum 5 MB." }, 400);
    }

    // ── Build storage path ────────────────────────────────────
    const ext      = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const fileName = `${crypto.randomUUID()}.${ext}`;
    const parts    = [cfg.prefix, entityId, fileName].filter(Boolean);
    const filePath = parts.join("/");

    // ── Upload ────────────────────────────────────────────────
    const buffer = await file.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from(cfg.bucket)
      .upload(filePath, buffer, { contentType: file.type, upsert: false });

    if (uploadErr) {
      return json({ error: uploadErr.message }, 500);
    }

    const { data: urlData } = supabase.storage
      .from(cfg.bucket)
      .getPublicUrl(filePath);

    return json({ success: true, url: urlData.publicUrl, path: filePath, bucket: cfg.bucket });

  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
