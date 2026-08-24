import { NextResponse } from "next/server";
import { z } from "zod";

import type { AccountService } from "../../../../../auth/account-service";
import { createAccountRuntime } from "../../../../../auth/account-runtime";
import { createSessionCookie } from "../../../../../auth/session-cookie";
import {
  accountRateLimitKeys,
  normalizeAccountRouteEmail,
  passwordHasPolicyLength,
  rateLimitedAccountResponse,
  readAccountPost,
} from "../../account-request";

const signInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().refine(passwordHasPolicyLength),
}).strict();

type SessionCookie = ReturnType<typeof createSessionCookie>;
type SignInPostDependencies = {
  service: Pick<AccountService, "signInPassword">;
  canonicalOrigin: string;
  rateLimitSecret: string;
  createSessionCookie(token: string, expiresAt: Date): SessionCookie;
};

export function createPasswordSignInPost(dependencies: SignInPostDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const parsed = await readAccountPost(request, signInSchema, dependencies.canonicalOrigin);
    if (!parsed.ok) return parsed.response;
    const email = normalizeAccountRouteEmail(parsed.data.email);
    const result = await dependencies.service.signInPassword({
      email,
      password: parsed.data.password,
      ...accountRateLimitKeys(dependencies.rateLimitSecret, parsed.clientIp, email),
    });
    if (result.kind === "rate_limited") return rateLimitedAccountResponse();
    if (result.kind === "invalid") {
      return Response.json({ ok: false, message: "Unable to sign in." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true, message: "Signed in." });
    const cookie = dependencies.createSessionCookie(result.token, result.expiresAt);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = await createAccountRuntime();
    return createPasswordSignInPost({ ...runtime, createSessionCookie })(request);
  } catch {
    return Response.json({ ok: false, message: "Account service unavailable." }, { status: 503 });
  }
}
