import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateKeyPair, type KeyLike, SignJWT } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { verifyFirebasePhoneToken } from "./firebase.ts";

const PROJECT = "restaurants-test";
Deno.env.set("FIREBASE_PROJECT_ID", PROJECT);

const { publicKey, privateKey } = await generateKeyPair("RS256");
const other = await generateKeyPair("RS256");
const now = () => Math.floor(Date.now() / 1000);

async function token(
  claims: Record<string, unknown> = {},
  opts: { key?: KeyLike; iss?: string; aud?: string; authAgo?: number } = {},
) {
  return await new SignJWT({
    phone_number: "+201012345678",
    firebase: { sign_in_provider: "phone" },
    auth_time: now() - (opts.authAgo ?? 5),
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(opts.aud ?? PROJECT)
    .setSubject("uid-1")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(opts.key ?? privateKey);
}

Deno.test("accepts a fresh phone sign-in for our project", async () => {
  const r = await verifyFirebasePhoneToken(await token(), publicKey);
  assertEquals(r, { ok: true, phone: "+201012345678", uid: "uid-1" });
});

Deno.test("rejects a token signed by another key", async () => {
  const r = await verifyFirebasePhoneToken(await token({}, { key: other.privateKey }), publicKey);
  assertEquals(r.ok, false);
});

Deno.test("rejects another project's token", async () => {
  const r = await verifyFirebasePhoneToken(
    await token({}, { aud: "someone-else", iss: "https://securetoken.google.com/someone-else" }),
    publicKey,
  );
  assertEquals(r.ok, false);
});

Deno.test("rejects non-phone providers", async () => {
  const r = await verifyFirebasePhoneToken(
    await token({ firebase: { sign_in_provider: "google.com" } }),
    publicKey,
  );
  assertEquals(r, { ok: false, error: "not a phone sign-in" });
});

Deno.test("rejects a token without a phone number", async () => {
  const r = await verifyFirebasePhoneToken(await token({ phone_number: undefined }), publicKey);
  assertEquals(r, { ok: false, error: "missing phone_number" });
});

Deno.test("rejects a sign-in older than 10 minutes", async () => {
  const r = await verifyFirebasePhoneToken(await token({}, { authAgo: 11 * 60 }), publicKey);
  assertEquals(r, { ok: false, error: "stale sign-in" });
});
