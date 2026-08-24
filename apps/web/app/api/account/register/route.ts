import { z } from "zod";

import type { AccountService } from "../../../../auth/account-service";
import { createAccountRuntime } from "../../../../auth/account-runtime";
import {
  acceptedAccountResponse,
  accountRateLimitKeys,
  normalizeAccountRouteEmail,
  passwordHasPolicyLength,
  rateLimitedAccountResponse,
  readAccountPost,
} from "../account-request";

const legalRevision = "2026-08-24";
const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().refine(passwordHasPolicyLength),
}).strict();

type RegisterPostDependencies = {
  service: Pick<AccountService, "register">;
  canonicalOrigin: string;
  rateLimitSecret: string;
  legalRevision: string;
};

export function createRegisterPost(dependencies: RegisterPostDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const parsed = await readAccountPost(request, registrationSchema, dependencies.canonicalOrigin);
    if (!parsed.ok) return parsed.response;
    const email = normalizeAccountRouteEmail(parsed.data.email);
    const result = await dependencies.service.register({
      email,
      password: parsed.data.password,
      legalRevision: dependencies.legalRevision,
      ...accountRateLimitKeys(dependencies.rateLimitSecret, parsed.clientIp, email),
    });
    return result.kind === "rate_limited" ? rateLimitedAccountResponse() : acceptedAccountResponse();
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = await createAccountRuntime();
    return createRegisterPost({ ...runtime, legalRevision })(request);
  } catch {
    return Response.json({ ok: false, message: "Account service unavailable." }, { status: 503 });
  }
}
