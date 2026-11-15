/**
 * Verification of Firebase Authentication ID tokens.
 *
 * Firebase only *proves phone ownership* for the SMS fallback — it is not
 * our auth system. A token is accepted when it is a genuine Firebase ID
 * token for our project, issued for a phone sign-in, recently.
 *
 * Checks (per Firebase's "verify ID tokens using a third-party JWT
 * library" guidance): RS256 signature against Google's securetoken JWKS,
 * `iss` = https://securetoken.google.com/<project>, `aud` = <project>,
 * `exp`/`iat` sane, non-empty `sub`, plus our own: the sign-in provider
 * is `phone`, a `phone_number` claim is present, and the phone sign-in
 * happened within MAX_AUTH_AGE_SECONDS — an ID token lives for an hour,
 * and we don't want an old one replayed to mint a session.
 *
 * Env: FIREBASE_PROJECT_ID (e.g. "restaurants-b1d28").
 */

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type KeyLike,
} from "https://deno.land/x/jose@v5.9.6/index.ts";

const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

const MAX_AUTH_AGE_SECONDS = 10 * 60;

export function firebaseConfigured(): boolean {
  return Boolean(Deno.env.get("FIREBASE_PROJECT_ID"));
}

export type FirebasePhoneClaim =
  | { ok: true; phone: string; uid: string }
  | { ok: false; error: string };

/**
 * @param key  Overridable for tests; production always uses Google's JWKS.
 */
export async function verifyFirebasePhoneToken(
  idToken: string,
  key: JWTVerifyGetKey | KeyLike = JWKS,
): Promise<FirebasePhoneClaim> {
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!projectId) return { ok: false, error: "FIREBASE_PROJECT_ID not set" };

  try {
    // jose's overloads split on key vs. resolver; both are valid here.
    // deno-lint-ignore no-explicit-any
    const { payload } = await jwtVerify(idToken, key as any, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });

    const uid = typeof payload.sub === "string" ? payload.sub : "";
    if (!uid) return { ok: false, error: "missing sub" };

    // deno-lint-ignore no-explicit-any
    const firebase = (payload as any).firebase ?? {};
    if (firebase.sign_in_provider !== "phone") {
      return { ok: false, error: "not a phone sign-in" };
    }

    const phone = (payload as Record<string, unknown>).phone_number;
    if (typeof phone !== "string" || !phone) {
      return { ok: false, error: "missing phone_number" };
    }

    const authTime = Number((payload as Record<string, unknown>).auth_time);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(authTime) || now - authTime > MAX_AUTH_AGE_SECONDS) {
      return { ok: false, error: "stale sign-in" };
    }

    return { ok: true, phone, uid };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
