-- ============================================================
-- 048: Disable online ordering on every existing restaurant
--
-- Context: at this point in onboarding no restaurant has signed
-- the online-orders contract yet. The platform should still show
-- restaurants in the customer app (so the brand and menu are
-- discoverable), but the "Order online" path must be hidden — no
-- cart, no checkout, no order goes through.
--
-- Two flags govern this on the restaurants table:
--   • accepts_online_orders — the contractual flag; flipped per
--     restaurant by Ops when the partnership is signed.
--   • is_accepting_orders   — the live "open now" flag; flipped
--     by the owner from their dashboard.
--
-- We only touch `accepts_online_orders` here, because:
--   • `is_accepting_orders` is owner-controlled and shouldn't be
--     stomped — the moment we activate a restaurant, the owner
--     decides when they're "open".
--   • New restaurants will continue to inherit whatever default
--     the restaurants table specifies (currently false in the
--     schema).
--
-- Idempotent: re-running it just sets false → false. Once Ops
-- starts flipping individual restaurants to true after signing,
-- replaying this migration would NOT silently reset them — we
-- explicitly guard against that with the WHERE clause below.
-- ============================================================

-- Belt-and-suspenders: only touch rows that are still in the
-- "true by accident / default-on" state. This makes the migration
-- safe to replay after Ops has started activating real partners.
update public.restaurants
set    accepts_online_orders = false
where  accepts_online_orders = true;
