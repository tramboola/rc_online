import { NextResponse } from "next/server";
import { z } from "zod";

import type { AccountService } from "../../../../auth/account-service";
import { createAccountRuntime } from "../../../../auth/account-runtime";
import { createClearedSessionCookie } from "../../../../auth/session-cookie";
import {
  accountRateLimitKeys,
  readAccountPost,
} from "../account-request";

const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE"),
}).strict();

type ClearedSessionCookie = ReturnType<typeof createClearedSessionCookie>;

type AccountDeleteRouteDependencies = {
  service: Pick<AccountService, "deleteAccount">;
  canonicalOrigin: string;
  rateLimitSecret: string;
  getSubject(): Promise<string | null>;
  createClearedSessionCookie(): ClearedSessionCookie;
};

function privateResponse(response: Response): Response {
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  return privateResponse(Response.json(body, init));
}

function unavailableResponse(): Response {
  return privateJson(
    { ok: false, message: "Account deletion unavailable." },
    { status: 503 },
  );
}

export function createAccountDeleteRoute(
  dependencies: AccountDeleteRouteDependencies,
) {
  return async function DELETE(request: Request): Promise<Response> {
    try {
      if (request.headers.get("origin") !== dependencies.canonicalOrigin) {
        return privateJson(
          { ok: false, message: "Cross-origin request rejected." },
          { status: 403 },
        );
      }

      const authenticatedSubject = await dependencies.getSubject();
      if (!authenticatedSubject) {
        return privateJson(
          { ok: false, message: "Sign in required." },
          { status: 401 },
        );
      }

      const parsed = await readAccountPost(
        request,
        deleteAccountSchema,
        dependencies.canonicalOrigin,
      );
      if (!parsed.ok) return privateResponse(parsed.response);

      // Resolve the shared cookie contract before the destructive transaction.
      const clearedCookie = dependencies.createClearedSessionCookie();
      const result = await dependencies.service.deleteAccount({
        authenticatedSubject,
        ...accountRateLimitKeys(
          dependencies.rateLimitSecret,
          parsed.clientIp,
          authenticatedSubject,
        ),
      });
      if (result.kind === "rate_limited") {
        return privateJson(
          { ok: false, message: "Account deletion unavailable." },
          { status: 429 },
        );
      }
      if (result.kind === "unavailable") return unavailableResponse();

      const response = NextResponse.json({
        ok: true,
        message: "Account deleted.",
      });
      response.cookies.set(
        clearedCookie.name,
        clearedCookie.value,
        clearedCookie.options,
      );
      return privateResponse(response);
    } catch {
      return unavailableResponse();
    }
  };
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const runtime = await createAccountRuntime();
    const { auth } = await import("../../../../auth");
    return createAccountDeleteRoute({
      service: runtime.service,
      canonicalOrigin: runtime.canonicalOrigin,
      rateLimitSecret: runtime.rateLimitSecret,
      getSubject: async () => (await auth())?.user?.id ?? null,
      createClearedSessionCookie,
    })(request);
  } catch {
    return unavailableResponse();
  }
}
