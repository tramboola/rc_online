import { z } from "zod";

import type { AccountService } from "../../../../auth/account-service";
import { createAccountRuntime } from "../../../../auth/account-runtime";
import { readAccountPost } from "../account-request";

const verificationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();

type VerifyPostDependencies = {
  service: Pick<AccountService, "verifyEmail">;
  canonicalOrigin: string;
};

export function createVerifyEmailPost(dependencies: VerifyPostDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const parsed = await readAccountPost(request, verificationSchema, dependencies.canonicalOrigin);
    if (!parsed.ok) return parsed.response;
    const result = await dependencies.service.verifyEmail({ token: parsed.data.token });
    return result.kind === "verified"
      ? Response.json({ ok: true, message: "Email verified." })
      : Response.json({ ok: false, message: "Verification link is invalid or expired." }, { status: 400 });
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = await createAccountRuntime();
    return createVerifyEmailPost(runtime)(request);
  } catch {
    return Response.json({ ok: false, message: "Account service unavailable." }, { status: 503 });
  }
}
