import { z } from "zod";

import type { AccountService } from "../../../../auth/account-service";
import { createAccountRuntime } from "../../../../auth/account-runtime";
import { passwordHasPolicyLength, rateLimitedAccountResponse } from "../account-request";
import {
  passwordRecoveryRateLimitKeys,
  readPasswordRecoveryPost,
} from "../password-recovery-request";

const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  password: z.string().refine(passwordHasPolicyLength),
}).strict();

type ResetPasswordPostDependencies = {
  service: Pick<AccountService, "resetPassword">;
  canonicalOrigin: string;
  rateLimitSecret: string;
};

function noReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function createResetPasswordPost(dependencies: ResetPasswordPostDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const parsed = await readPasswordRecoveryPost(request, resetPasswordSchema, dependencies.canonicalOrigin);
    if (!parsed.ok) return noReferrer(parsed.response);
    const result = await dependencies.service.resetPassword({
      token: parsed.data.token,
      password: parsed.data.password,
      ...passwordRecoveryRateLimitKeys(
        dependencies.rateLimitSecret,
        parsed.clientIp,
        parsed.data.token,
      ),
    });
    if (result.kind === "rate_limited") return noReferrer(rateLimitedAccountResponse());
    return noReferrer(result.kind === "reset"
      ? Response.json({ ok: true, message: "Password updated." })
      : Response.json({ ok: false, message: "Reset link is invalid or expired." }, { status: 400 }));
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = await createAccountRuntime();
    return createResetPasswordPost(runtime)(request);
  } catch {
    return noReferrer(Response.json(
      { ok: false, message: "Account service unavailable." },
      { status: 503 },
    ));
  }
}
