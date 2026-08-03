import { createHash } from "node:crypto";

export function hashSessionToken(token: string): string {
  if (!token) {
    throw new Error("Session token is required");
  }

  return createHash("sha256").update(token, "utf8").digest("hex");
}
