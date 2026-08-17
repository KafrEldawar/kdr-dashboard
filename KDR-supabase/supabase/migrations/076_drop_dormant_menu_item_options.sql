-- ============================================================
-- 076: Drop the dormant menu_item_options scaffold
--
-- Migration 017 shipped `menu_item_options` + `menu_item_option_choices`
-- ("Groupings like الحجم، الإضافات") together with an admin RPC. The
-- design was never wired to anything: no dashboard module, no Flutter
-- model, no customer or owner RPC ever read either table, and
-- `rpc_admin_manage_menu_option` has no caller in any of the three
-- repos.
--
-- Migration 074 then introduced the model that actually ships —
-- `menu_item_variants` for priced sizes plus a per-restaurant
-- `menu_addon_groups` / `menu_addons` catalogue — without noticing 017's
-- tables were there. Leaving both in place would mean the schema
-- describes two different answers to "how does an item have options",
-- which is exactly the confusion migration 059 removed when it dropped
-- the equally dormant `restaurant_menu_categories`.
--
-- Why 074's model was kept as the survivor rather than 017's:
--
--   • 017 prices a choice as `price_extra`, a delta on the item price.
--     A family pizza is not "medium + delta"; it carries its own price,
--     and 074's absolute per-variant price is what lets the
--     `menu_items.price` sync trigger stay meaningful.
--   • 017's choices hang off a single menu item, so Za Burger's 15-line
--     "الأضافات" list would have to be re-authored on every burger.
--     074's add-on groups are per-restaurant and attach to many items.
--   • 017 was never taught to cart or checkout; 074 prices the cart line
--     and snapshots it onto the order.
--
-- Verified immediately before writing this migration, against the live
-- database:
--
--   menu_item_options rows          0
--   menu_item_option_choices rows   0
--   inbound FKs from other tables   0
--   views referencing either        0
--   other functions referencing     0   (only the RPC dropped below)
--
-- Nothing here is recoverable by re-running the migration, but there is
-- no data to lose — both tables have always been empty.
-- ============================================================

drop function if exists public.rpc_admin_manage_menu_option(
  text, uuid, uuid, uuid, text, text, boolean, boolean, numeric, boolean, integer
);

-- Child first: menu_item_option_choices carries the FK to menu_item_options.
drop table if exists public.menu_item_option_choices;
drop table if exists public.menu_item_options;
