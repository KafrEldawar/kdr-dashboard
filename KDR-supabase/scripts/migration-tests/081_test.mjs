import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

// Usage: node 081_test.mjs <stub_schema.sql> <migration.sql>
const [stubPath, migPath] = process.argv.slice(2);
const db = new PGlite();
await db.exec(fs.readFileSync(stubPath, "utf8"));
await db.exec(fs.readFileSync(migPath, "utf8"));

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!cond) failures++; };
const U1 = "11111111-1111-1111-1111-111111111111", ADMIN = "22222222-2222-2222-2222-222222222222";
const R1 = "aaaaaaaa-0000-0000-0000-000000000001", R2 = "aaaaaaaa-0000-0000-0000-000000000002";
const B1 = "bbbbbbbb-0000-0000-0000-000000000001", B2 = "bbbbbbbb-0000-0000-0000-000000000002", B3 = "bbbbbbbb-0000-0000-0000-000000000003";
const M1 = "cccccccc-0000-0000-0000-000000000001", M2 = "cccccccc-0000-0000-0000-000000000002", M3 = "cccccccc-0000-0000-0000-000000000003";
const V1 = "dddddddd-0000-0000-0000-000000000001", A1 = "eeeeeeee-0000-0000-0000-000000000001", A2 = "eeeeeeee-0000-0000-0000-000000000002";
const ADDR = "ffffffff-0000-0000-0000-000000000001", VOUCH = "99999999-0000-0000-0000-000000000001";
const U2 = "33333333-3333-3333-3333-333333333333", VOUCH2 = "99999999-0000-0000-0000-000000000002";
const ADDR2 = "ffffffff-0000-0000-0000-000000000002";

await db.exec(`
  insert into auth.users values ('${U1}', 'U1@phone.kdr.app');
  insert into profiles(id, role, phone) values ('${U1}', 'customer', '01012345678'), ('${ADMIN}', 'admin', null);
  insert into restaurants values ('${R1}', true, true, 10), ('${R2}', true, true, 10);
  insert into branches values ('${B1}', '${R1}', 31.1, 30.1), ('${B2}', '${R1}', 31.2, 30.2), ('${B3}', '${R2}', 31.3, 30.3);
  insert into menu_items values ('${M1}', '${R1}', 100, true, 'Burger', 'برجر'), ('${M2}', '${R1}', 50, false, 'Fries', 'بطاطس'), ('${M3}', '${R2}', 70, true, 'Pizza', 'بيتزا');
  insert into menu_item_variants values ('${V1}', '${M1}', 120, true, 'كبير', 'Large');
  insert into menu_addons values ('${A1}', 15, true, 'جبنة', 'Cheese'), ('${A2}', 10, false, 'صوص', 'Sauce');
  insert into user_addresses values ('${ADDR}', '${U1}', 'شارع', 31.15, 30.15);
  insert into vouchers values ('${VOUCH}', 'SAVE', '${R1}', true, now() - interval '1 day', now() + interval '1 day', 1, 0, 0, 'fixed', 20);
  insert into vouchers values ('${VOUCH2}', 'WELCOME', '${R1}', true, now() - interval '1 day', now() + interval '1 day', null, 0, 0, 'percentage', 10);
  insert into profiles(id, role) values ('${U2}', 'customer');
  insert into user_addresses values ('${ADDR2}', '${U2}', 'شارع ٢', 31.16, 30.16);
`);

async function as(uid, role, fn) {
  await db.exec(`set request.jwt.claim.sub = '${uid}'; set role ${role};`);
  try { return await fn(); } finally { await db.exec(`reset role; set request.jwt.claim.sub = '';`); }
}
async function cart(items, uid = U1) {
  await db.exec(`delete from cart_items; delete from carts; insert into carts(user_id) values ('${uid}');`);
  for (const [m, q, v, addons] of items) {
    await db.query(`insert into cart_items(cart_id, menu_item_id, quantity, variant_id, addon_ids) select id, $1, $2, $3, $4 from carts where user_id = $5`,
      [m, q, v ?? null, addons ?? [], uid]);
  }
}
async function validate(code, uid = U1) {
  const res = await as(uid, "postgres", () => db.query(`select public.rpc_validate_voucher($1, $2, 100) as r`, [code, R1]));
  return res.rows[0].r;
}
async function checkout(args, uid = U1) {
  const res = await as(uid, "postgres", () => db.query(
    `select public.rpc_checkout(p_delivery_address_id => $1, p_branch_id => $2, p_contact_phone => '0100', p_voucher_code => $3, p_order_type => $4) as r`,
    [args.addr ?? null, args.branch ?? null, args.voucher ?? null, args.type ?? "delivery"]));
  return res.rows[0].r;
}

// 1) lookup function privileges
const priv = await db.query(`select has_function_privilege('authenticated','public.admin_auth_user_id_by_email(text)','execute') a,
  has_function_privilege('service_role','public.admin_auth_user_id_by_email(text)','execute') s, public.admin_auth_user_id_by_email(' u1@PHONE.kdr.app ') id`);
ok("email lookup is service_role-only", priv.rows[0].a === false && priv.rows[0].s === true);
ok("email lookup is case/space-insensitive", priv.rows[0].id === U1);

// 2) policies dropped
const pol = await db.query(`select count(*)::int n from pg_policies where policyname in ('order_items: insert via rpc','user_notifications: insert allowed','audit_logs: insert via rpc','favorites: public count visible')`);
ok("permissive policies dropped", pol.rows[0].n === 0);
let denied = false;
try { await as(U1, "authenticated", () => db.query(`insert into user_notifications(user_id) values ('${ADMIN}')`)); } catch (e) { denied = /row-level security/.test(e.message); }
ok("user can no longer insert notifications for others", denied);

// 3) profile guard
await as(U1, "authenticated", () => db.query(`update profiles set full_name = 'Ahmed' where id = '${U1}'`));
ok("user can still change own name", (await db.query(`select full_name from profiles where id='${U1}'`)).rows[0].full_name === "Ahmed");
for (const [col, val] of [["phone", "'01099999999'"], ["is_tester", "true"], ["phone_verified_at", "now()"], ["role", "'admin'"]]) {
  let blocked = false;
  try { await as(U1, "authenticated", () => db.query(`update profiles set ${col} = ${val} where id = '${U1}'`)); } catch (e) { blocked = /privileged_profile_column/.test(e.message); }
  ok(`direct write of ${col} is blocked`, blocked);
}
await as(ADMIN, "authenticated", () => db.query(`update profiles set is_tester = true where id = '${U1}'`));
ok("admin can still set is_tester", (await db.query(`select is_tester from profiles where id='${U1}'`)).rows[0].is_tester === true);
const same = await as(U1, "authenticated", () => db.query(`select public.rpc_update_profile(p_full_name => 'Ahmed R', p_phone => '+201012345678') r`));
ok("rpc_update_profile accepts the unchanged phone (legacy local format stored)", !same.rows[0].r.error && same.rows[0].r.full_name === "Ahmed R", JSON.stringify(same.rows[0].r.error ?? ""));
const diff = await as(U1, "authenticated", () => db.query(`select public.rpc_update_profile(p_phone => '01055555555') r`));
ok("rpc_update_profile refuses a different phone", diff.rows[0].r.error === "phone_change_requires_verification");
ok("phone untouched", (await db.query(`select phone from profiles where id='${U1}'`)).rows[0].phone === "01012345678");

// 4) checkout
await cart([[M1, 1], [M3, 1]]);
ok("two-restaurant cart refused", (await checkout({ addr: ADDR, branch: B1 })).error === "cart_conflict");
await cart([[M1, 1], [M2, 1]]);
ok("unavailable item refused", (await checkout({ addr: ADDR, branch: B1 })).error === "item_unavailable");
await cart([[M1, 1, null, [A2]]]);
ok("unavailable add-on refused", (await checkout({ addr: ADDR, branch: B1 })).error === "addon_unavailable");
await cart([[M1, 1]]);
ok("delivery at multi-branch needs a branch", /branch_id is required/.test((await checkout({ addr: ADDR })).error ?? ""));
await cart([[M1, 1]]);
const pickupNoBranch = await checkout({ type: "pickup" });
ok("pickup without branch still works for old apps (branch null)", pickupNoBranch.id && pickupNoBranch.branch_id === null);
await cart([[M1, 1]]);
const pickup = await checkout({ type: "pickup", branch: B2 });
ok("pickup records the chosen branch", pickup.branch_id === B2 && Number(pickup.delivery_fee) === 0);
await cart([[M1, 1]]);
ok("branch of another restaurant refused", /Invalid branch/.test((await checkout({ type: "pickup", branch: B3 })).error ?? ""));
await cart([[M1, 2, V1, [A1]]]);
const del = await checkout({ addr: ADDR, branch: B1, voucher: "SAVE" });
// 2 × (120 + 15) = 270; discount 20; fee 25 → 275; commission 10% of 270 = 27, platform absorbs 20 → 7
ok("totals: variant + add-on priced, voucher + fee applied", Number(del.subtotal) === 270 && Number(del.discount) === 20 && Number(del.total_amount) === 275,
   `${del.subtotal}/${del.discount}/${del.total_amount}`);
ok("commission split unchanged (053)", Number(del.commission_gross) === 27 && Number(del.discount_platform_share) === 20 && Number(del.commission_amount) === 7);
ok("voucher counted", (await db.query(`select used_count from vouchers where id = '${VOUCH}'`)).rows[0].used_count === 1);
await cart([[M1, 1]]);
ok("voucher limit enforced", /usage limit/.test((await checkout({ addr: ADDR, branch: B1, voucher: "SAVE" })).error ?? ""));

// 5) voucher release
await db.query(`update orders set status = 'rejected' where id = $1`, [del.id]);
ok("rejected order gives the voucher use back", (await db.query(`select used_count from vouchers where id = '${VOUCH}'`)).rows[0].used_count === 0);
await db.query(`update orders set status = 'cancelled' where id = $1`, [del.id]);
ok("rejected → cancelled doesn't double-release", (await db.query(`select used_count from vouchers where id = '${VOUCH}'`)).rows[0].used_count === 0);
await db.query(`update orders set status = 'preparing' where id = $1`, [del.id]);
ok("reviving the order counts the use again", (await db.query(`select used_count from vouchers where id = '${VOUCH}'`)).rows[0].used_count === 1);
await db.query(`update orders set status = 'delivered' where id = $1`, [del.id]);
ok("normal progress leaves the count alone", (await db.query(`select used_count from vouchers where id = '${VOUCH}'`)).rows[0].used_count === 1);

// 6) one use per customer
ok("validate: fresh customer may use WELCOME", (await validate("WELCOME")).valid === true);
await cart([[M1, 1]]);
const w1 = await checkout({ addr: ADDR, branch: B1, voucher: "WELCOME" });
ok("first use of WELCOME goes through", Boolean(w1.id) && Number(w1.discount) === 10, JSON.stringify(w1.error ?? ""));
ok("validate: same customer is told it's used", (await validate("WELCOME")).error === "voucher_already_used");
await cart([[M1, 1]]);
ok("checkout: same customer can't use it twice", (await checkout({ addr: ADDR, branch: B1, voucher: "WELCOME" })).error === "voucher_already_used");
ok("validate: another customer still can", (await validate("WELCOME", U2)).valid === true);
await cart([[M1, 1]], U2);
const w2 = await checkout({ addr: ADDR2, branch: B1, voucher: "WELCOME" }, U2);
ok("checkout: another customer still can", Boolean(w2.id), JSON.stringify(w2.error ?? ""));
await db.query(`update orders set status = 'cancelled' where id = $1`, [w1.id]);
ok("a cancelled order gives the customer the code back", (await validate("WELCOME")).valid === true);
const priv2 = await db.query(`select has_function_privilege('authenticated','public.voucher_used_by(uuid,uuid)','execute') a`);
ok("voucher_used_by is not callable by clients", priv2.rows[0].a === false);

// idempotent re-run
await db.exec(fs.readFileSync(migPath, "utf8"));
ok("migration re-runs cleanly", true);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
