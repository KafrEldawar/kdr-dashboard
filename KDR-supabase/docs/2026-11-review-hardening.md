# Review hardening — November 2026

Fixes from the full project review of 2026-11-14 (mobile app, dashboard,
Supabase). This page is the deploy checklist: what changed, the order to
ship it in, how to check it, and how to back out.

Branches: `fix/review-hardening-2026-11` in **KDR** (dashboard + Supabase)
and in **kafr_aldawar_restaurants** (mobile).

---

## What changed

### 1. Phone login ("I send the code on WhatsApp and nothing comes back")

Our side was checked live on 2026-11-14 and works: `wasage-start` opens
verifications, the secrets are set, `wasage-webhook` is reachable. Wasage
replies to every message it processes, *even from the wrong number*, so
getting no reply at all means wasage never handled the inbound message.
That points at wasage's receiving number (+971 50 126 3864) or the wasage
account (balance/plan). **Check the wasage console first** (see the end).

**Live data, read on 2026-11-15:** the last successful wasage confirmation
was **2026-10-05 13:29 UTC**. Since then there have been 136 attempts from 74
people, all stuck at `pending`, so phone login has been down for six weeks.
In the last 24 h the webhook received two calls, both rejected 401, against 9
attempts: wasage isn't calling back. Other live facts behind this work: 265
auth users (past the old 200-user lookup), 43 of 49 branches without a map
pin, and one customer who used the same voucher twice.

What we changed so a wasage outage stops locking people out:

| Where | Change |
|---|---|
| App, `OtpCubit` + `WasagePendingStore` | The pending verification is saved to disk. If Android kills the app while the user is in WhatsApp, the login / phone-entry screen picks it up and finishes it. Before, wasage's confirmation landed on a row nobody would ever claim. |
| App, `WasageWaitScreen` | Polls the moment the app returns to the foreground (iOS froze the 2s timer). Shows the token and the wasage number with a copy button for when WhatsApp opens without the pre-filled text. |
| App + new edge fn `firebase-phone-complete` | **SMS fallback**: "مجاليش رد؟ أكّد برسالة SMS". Firebase phone auth sends a 6-digit SMS; the Firebase ID token is verified server-side (Google JWKS, project, `phone` provider, signed in within 10 min) and the session is minted by the same code wasage uses. Off until Firebase is set up — Remote Config `otp_sms_fallback_enabled`. |
| Dashboard `/status` | The dead Railway "WhatsApp sender" card is replaced by a **login health** card computed from `wasage_verifications`: success rate, "no reply from wasage", wrong-number, SMS fallbacks, last successful login. It turns red when nobody has verified in the last hour. |

### 2. Account/session bugs (`_shared/session.ts`, used by verify-otp, wasage-complete, firebase-phone-complete)

- **Owners and drivers lost their password** if they ever used the phone
  card: signing in reset the account password to a random value. Sessions
  are now minted with an admin magic-link token (no email is sent, the
  password is untouched). The password-reset path remains only as a
  fallback for synthetic `@phone.kdr.app` accounts.
- The synthetic-email lookup only searched the **first 200 users**. It now
  uses `admin_auth_user_id_by_email()` (migration 081, service-role only),
  falling back to paging through every user.
- **Changing your phone left your account reachable through the old
  number.** Attaching a new phone now moves the synthetic email with it,
  and an account whose profile has moved to another number is no longer
  signed into by whoever verifies the old one.
- `verify-otp` now uses the shared helpers instead of its own copy.
- All functions import `../_shared/…` (`send-otp`, `verify-otp` and
  `whatsapp-webhook` used `./_shared/…`, which only resolved in a custom
  MCP bundle layout).

### 3. Database — migration `081_security_and_checkout_hardening.sql`

- Dropped `with check (true)` insert policies on `order_items`,
  `user_notifications`, `audit_logs` (anyone could add items to another
  customer's order, push fake notifications, forge audit rows) and the
  policy exposing every user's favourites.
- `profiles.role / is_tester / phone / phone_verified_at` can't be written
  through the REST API by end users any more (trigger). `rpc_update_profile`
  no longer changes the phone — that allowed claiming any number without
  verification, and login resolves accounts by `profiles.phone`.
- `rpc_checkout` refuses a two-restaurant cart (`cart_conflict`) and items /
  sizes / add-ons switched off after they were added (`item_unavailable`,
  `variant_unavailable`, `addon_unavailable`); stores the **branch for
  pickup orders**; locks the voucher row against concurrent over-use.
- A cancelled or rejected order **gives its voucher use back** (trigger).
- **A voucher can be used once per customer** — refused at apply time
  (`rpc_validate_voucher`) and at checkout (`voucher_already_used`). A
  cancelled or rejected order gives the customer the code back. The app
  now shows every voucher refusal in Arabic (they used to appear in
  English), and the dashboard's promo-code form states the rule.

Tested with PGlite: `KDR-supabase/scripts/migration-tests` (37 checks).

### 4. Dashboard

- `/api/status` and `/api/whatsapp/session` required **no login at all**
  (the latter can wipe the WhatsApp session). Both now require an admin's
  Supabase token (`src/lib/server/require-admin.ts`); the pages send it via
  `adminFetch`. `/api/system-events` compares its token in constant time.
- The app shell and login page require `profiles.role = 'admin'`. Owners
  and drivers (who have email + password accounts) used to get into the
  admin UI.
- `/branches` flags every branch with no map pin ("بدون موقع — التوصيل
  متوقف") with a count banner and a filter. Delivery from those branches
  is refused at checkout, so pinning them is the fix. It also loads every
  branch now: the old 50-row page could hide the rest.
- `/whatsapp` says plainly that the Railway sender is retired and doesn't
  affect login.
- ESLint no longer lints the Deno code under `KDR-supabase/` (use `deno lint`).

### 5. Mobile, other

- Pickup at a multi-branch restaurant asks which branch and sends it.
- New server error codes are mapped to Arabic messages.

### 6. Push notifications (`send-push`)

Pool pushes ("طلب توصيل جديد" and pool cancellations) skip riders who are
already on a delivery and offices at `max_concurrent_orders`, plus
suspended providers. Mirrors `provider_spare_capacity()`; fails open.

---

## Deploy order

Everything is backward compatible in both directions (old app ↔ new
backend, new app ↔ old backend), but this order is the safe one.

1. **Supabase access.** `supabase projects list` must show
   `rkhygtgmcurwemuzizep`. On 2026-11-14 the CLI and the MCP connector were
   logged into a personal account that couldn't see it. Fix that first.
2. ~~**Migration 081**~~ — ✅ **APPLIED to production on 2026-11-15** from the
   dashboard SQL editor, as one transaction, and recorded in
   `supabase_migrations.schema_migrations` as `20261115120000 /
   081_security_and_checkout_hardening`. Verified afterwards: the four
   policies are gone, both triggers and the index exist, the privileges are as
   intended, and all seven function bodies hash-match the file. (The editor
   auto-closes brackets on multi-line input, so the migration was sent as one
   line with comments stripped; the identical text passed the PGlite suite
   first.)
3. **Edge functions** (the files now use `../_shared`, so the CLI works):
   ```bash
   cd KDR/KDR-supabase
   supabase secrets set FIREBASE_PROJECT_ID=restaurants-b1d28
   supabase functions deploy wasage-complete verify-otp send-otp send-push whatsapp-webhook
   supabase functions deploy firebase-phone-complete
   ```
   `firebase-phone-complete` keeps JWT verification **on**, like `wasage-complete`.
   `send-otp` also picks up the 4/15 rate limits it was still missing.
4. **Dashboard**: deploy `fix/review-hardening-2026-11` as usual. No new env vars.
5. **Mobile**: release as usual (`flutter pub get`, `cd ios && pod install`).
   The SMS button stays hidden until step 6.
6. **Firebase phone auth** (only when you want the SMS fallback):
   1. Firebase console → Authentication → Sign-in method → enable **Phone**.
   2. Project on the **Blaze** plan (SMS is billed per message; check the
      Egypt rate in the pricing page and set a budget alert).
   3. Android app → add the **SHA-1 and SHA-256** of the upload key *and*
      of the Play App Signing key (Play Console → App integrity).
   4. iOS → Cloud Messaging → APNs auth key uploaded (silent-push
      verification; the reCAPTCHA URL scheme is already in `Info.plist`).
   5. Test on a real Android and iPhone, then set Remote Config
      `otp_sms_fallback_enabled = true` and publish.

## Verify after deploy

- `/status` → "تسجيل الدخول (واتساب)" shows the last 24h funnel.
- Log in as an owner with the phone card, then log in with email +
  password: the password must still work.
- Customer: change phone in profile, then try logging in with the *old*
  number: it must create/enter a different account, not yours.
- Pickup at a multi-branch restaurant: the owner sees the chosen branch.
- Reject an order that used a limited voucher: the voucher's `used_count` drops.
- Use a voucher, then try it again from the same account: "انت استخدمت كود
  الخصم ده قبل كده". A different account can still use it.
- `/api/status` without a token returns 401.

## Rollback

- Edge functions: redeploy the previous version from the Supabase
  dashboard (Functions → versions).
- Migration 081, per section: re-run `rpc_checkout` from 078 and
  `rpc_update_profile` from 051; `drop trigger trg_profiles_guard_privileged_columns on profiles;`
  `drop trigger trg_orders_release_voucher on orders;`. Don't restore the
  dropped policies: they were the holes.
- SMS fallback: Remote Config `otp_sms_fallback_enabled = false`, no release needed.

## Wasage: what to check on their side

1. Send the token by hand from your phone to +971 50 126 3864. One grey
   tick means their number is offline or banned. Two ticks with no reply
   means it's delivered but wasage isn't processing it.
2. wasage console → balance / plan, the **Server Callback URL**
   (`https://rkhygtgmcurwemuzizep.supabase.co/functions/v1/wasage-webhook`)
   and that the Secret still matches `WASAGE_SECRET`.
3. Ask wasage support for their inbound log for the failing numbers and
   times. We have no record of messages they never forwarded.
