import { createHash, randomBytes } from "node:crypto";

const accountTokenByteLength = 32;

export function createAccountToken(): { raw: string; hash: string } {
  const raw = randomBytes(accountTokenByteLength).toString("base64url");

  return { raw, hash: hashAccountToken(raw) };
}

export function hashAccountToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
