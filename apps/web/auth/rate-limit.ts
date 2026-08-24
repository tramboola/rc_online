import { createHmac } from "node:crypto";

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export function hashRateLimitKey(secret: string, value: string): string {
  const normalizedValue = value.normalize("NFKC").trim().toLowerCase();

  return createHmac("sha256", secret).update(normalizedValue, "utf8").digest("hex");
}
