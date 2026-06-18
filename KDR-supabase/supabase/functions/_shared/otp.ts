/**
 * OTP code generation + bcrypt-style hashing.
 *
 * We use bcrypt via esm.sh. Deno's native crypto.subtle has PBKDF2
 * but not bcrypt, and bcrypt is what most server-side codebases
 * recognize for OTP-shaped secrets.
 */

import * as bcrypt from "https://esm.sh/bcryptjs@2.4.3";

/** Generate a uniformly random 6-digit numeric OTP as a string. */
export function generateCode(): string {
  // crypto.getRandomValues gives uniformly distributed bytes; modulo
  // a power of 10 introduces a slight bias but for a 6-digit OTP it
  // is well within acceptable. Rejection-sample for cleanliness:
  while (true) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const n = buf[0];
    // 4_294_000_000 is the largest multiple of 1_000_000 below 2^32.
    if (n < 4_294_000_000) {
      return (n % 1_000_000).toString().padStart(6, "0");
    }
  }
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(code, hash);
  } catch {
    return false;
  }
}
