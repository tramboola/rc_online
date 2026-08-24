import { z } from "zod";

import type { AccountService } from "../../../../auth/account-service";
import { createAccountRuntime } from "../../../../auth/account-runtime";
import {
  acceptedAccountResponse,
  normalizeAccountRouteEmail,
  rateLimitedAccountResponse,
} from "../account-request";
import {
  passwordRecoveryRateLimitKeys,
  readPasswordRecoveryPost,
} from "../password-recovery-request";

const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(254) }).strict();

type ForgotPasswordPostDependencies = {
  service: Pick<AccountService, "requestPasswordReset">;
  canonicalOrigin: string;
  rateLimitSecret: string;
};

export function createForgotPasswordPost(dependencies: ForgotPasswordPostDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const parsed = await readPasswordRecoveryPost(request, forgotPasswordSchema, dependencies.canonicalOrigin);
    if (!parsed.ok) return parsed.response;
    const email = normalizeAccountRouteEmail(parsed.data.email);
    const result = await dependencies.service.requestPasswordReset({
      email,
      ...passwordRecoveryRateLimitKeys(dependencies.rateLimitSecret, parsed.clientIp, email),
    });
    return result.kind === "rate_limited" ? rateLimitedAccountResponse() : acceptedAccountResponse();
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = await createAccountRuntime();
    return createForgotPasswordPost(runtime)(request);
  } catch {
    return Response.json({ ok: false, message: "Account service unavailable." }, { status: 503 });
  }
}
