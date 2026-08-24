import { z } from "zod";

import type { AccountService } from "../../../../auth/account-service";
import { createAccountRuntime } from "../../../../auth/account-runtime";
import {
  acceptedAccountResponse,
  accountRateLimitKeys,
  normalizeAccountRouteEmail,
  rateLimitedAccountResponse,
  readAccountPost,
} from "../account-request";

const resendSchema = z.object({ email: z.string().trim().email().max(254) }).strict();

type ResendPostDependencies = {
  service: Pick<AccountService, "resendVerification">;
  canonicalOrigin: string;
  rateLimitSecret: string;
};

export function createResendVerificationPost(dependencies: ResendPostDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const parsed = await readAccountPost(request, resendSchema, dependencies.canonicalOrigin);
    if (!parsed.ok) return parsed.response;
    const email = normalizeAccountRouteEmail(parsed.data.email);
    const result = await dependencies.service.resendVerification({
      email,
      ...accountRateLimitKeys(dependencies.rateLimitSecret, parsed.clientIp, email),
    });
    return result.kind === "rate_limited" ? rateLimitedAccountResponse() : acceptedAccountResponse();
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = await createAccountRuntime();
    return createResendVerificationPost(runtime)(request);
  } catch {
    return Response.json({ ok: false, message: "Account service unavailable." }, { status: 503 });
  }
}
