# KDR Supabase — Manual Setup Checklist

All SQL migrations (001–016) and Edge Functions are applied.
These are the remaining one-time manual steps in the Supabase Dashboard.

---

## 1. Auth Providers

### Google OAuth
1. Go to **Authentication → Providers → Google**
2. Enable Google
3. Add OAuth credentials:
   - Client ID: `<from Google Cloud Console>`
   - Client Secret: `<from Google Cloud Console>`
4. In Google Cloud Console, add authorized redirect URI:
   `https://rkhygtgmcurwemuzizep.supabase.co/auth/v1/callback`

### Apple OAuth
1. Go to **Authentication → Providers → Apple**
2. Enable Apple
3. Add credentials:
   - Service ID: `<from Apple Developer account>`
   - Key ID + Private Key: `<from Apple Developer account>`
4. In Apple Developer, add redirect URI:
   `https://rkhygtgmcurwemuzizep.supabase.co/auth/v1/callback`

---

## 2. Custom Access Token Hook (JWT enrichment)

> Adds `user_role` and `restaurant_id` directly into JWT claims so RLS
> policies never need a separate DB lookup.

1. Go to **Authentication → Hooks**
2. Click **Add hook**
3. Select **Custom Access Token**
4. Set function: `public.custom_access_token_hook`
5. Save

---

## 3. Edge Function Secrets

Go to **Edge Functions → Manage secrets** (or use Supabase CLI: `supabase secrets set`).

Add these secrets:

| Secret | Value |
|--------|-------|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Full Firebase service account JSON as a single-line string. Get from Firebase Console → Project Settings → Service Accounts → Generate new private key |

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into Edge Functions.

---

## 4. Database Webhooks (auto push notifications on order events)

> These trigger the `send-push` Edge Function when orders are created/updated.

### Webhook 1: New order placed → notify restaurant owner
1. Go to **Database → Webhooks**
2. Create new webhook:
   - **Name**: `on_new_order`
   - **Table**: `public.orders`
   - **Events**: `INSERT`
   - **Type**: HTTP Request
   - **URL**: `https://rkhygtgmcurwemuzizep.supabase.co/functions/v1/send-push`
   - **HTTP Headers**:
     - `Content-Type`: `application/json`
     - `Authorization`: `Bearer <service_role_key>`
   - **HTTP Body** (template):
     ```json
     { "event": "new_order", "order_id": "{{ NEW_RECORD.id }}" }
     ```

### Webhook 2: Order status changed → notify customer
1. Create another webhook:
   - **Name**: `on_order_status_change`
   - **Table**: `public.orders`
   - **Events**: `UPDATE`
   - **HTTP Condition**: Only fire when `status` column changes
   - **URL**: `https://rkhygtgmcurwemuzizep.supabase.co/functions/v1/send-push`
   - **HTTP Headers**: same as above
   - **HTTP Body**:
     ```json
     { "event": "status_change", "order_id": "{{ NEW_RECORD.id }}" }
     ```

---

## 5. Create First Admin User

After your first signup:
```sql
-- Run in Supabase SQL Editor
update public.profiles
set role = 'admin'
where id = '<your-user-uuid>';
```

Or use the Supabase Dashboard → Authentication → Users to find the UUID.

---

## 6. CORS / Allowed Origins (optional)

Go to **API Settings** and add your app domains to the allowed origins if needed.

---

## Summary: What's Already Done

| # | Item | Status |
|---|------|--------|
| 001 | Extensions + Enums | ✅ Applied |
| 002 | Tables (20 tables) | ✅ Applied |
| 003 | Indexes (GIN + btree) | ✅ Applied |
| 004 | Functions + Triggers + JWT Hook | ✅ Applied |
| 005 | RLS Policies | ✅ Applied |
| 006 | Storage Buckets (4 buckets) | ✅ Applied |
| 007 | Security Fixes | ✅ Applied |
| 008 | Public RPC (restaurants, categories, menu, branches, offers, vouchers) | ✅ Applied |
| 009 | Profile + Notifications RPC | ✅ Applied |
| 010 | Cart RPC | ✅ Applied |
| 011 | Checkout + Orders RPC | ✅ Applied |
| 012 | Admin RPC | ✅ Applied |
| 013 | Restaurant Owner RPC | ✅ Applied |
| 014 | Notification Campaign RPC | ✅ Applied |
| 015 | Realtime (orders, user_notifications, cart_items) | ✅ Applied |
| 016 | Schema fixes + corrected RPCs | ✅ Applied |
| — | Edge Function: `upload-image` | ✅ Deployed |
| — | Edge Function: `send-push` (v2) | ✅ Deployed |
| — | JWT Hook registration | ⬜ Manual |
| — | Google OAuth | ⬜ Manual |
| — | Apple OAuth | ⬜ Manual |
| — | Firebase secret | ⬜ Manual |
| — | DB Webhooks for push notifications | ⬜ Manual |
| — | First admin user | ⬜ Manual |
