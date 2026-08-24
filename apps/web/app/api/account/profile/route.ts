import { z } from "zod";

import {
  createAccountRuntime,
  type AccountRuntime,
} from "../../../../auth/account-runtime";
import { hashRateLimitKey } from "../../../../auth/rate-limit";
import type {
  AccountStore,
  OwnProfile,
  RateLimitAttempt,
} from "../../../../auth/account-store";
import {
  isAvatarKey,
  normalizeProfileNickname,
} from "../../../../auth/avatar";

const maximumProfileBodyBytes = 4 * 1024;
const nicknameRateLimitWindowMs = 60_000;
const nicknameRateLimit = 5;

const profileRequestSchema = z.object({
  nickname: z.string(),
  avatarKey: z.string().refine(isAvatarKey),
}).strict();

type AccountProfileRouteDependencies = {
  canonicalOrigin: string;
  getSubject(): Promise<string | null>;
  getOwnProfile(subject: string): Promise<OwnProfile | null>;
  updateOwnProfile(
    subject: string,
    profile: Pick<OwnProfile, "nickname" | "avatarKey">,
  ): Promise<OwnProfile | null>;
  takeRateLimitAttempt(input: {
    keyHash: string;
    kind: "nickname";
    now: Date;
    windowMs: number;
    limit: number;
  }): Promise<RateLimitAttempt>;
  rateLimitSecret: string;
  now(): Date;
};

type AccountProfileProductionDependencies = {
  createRuntime(): Promise<
    Pick<AccountRuntime, "canonicalOrigin" | "rateLimitSecret">
    & {
      accountStore: Pick<
        AccountStore,
        "getOwnProfile" | "updateOwnProfile" | "takeRateLimitAttempt"
      >;
    }
  >;
  getSubject(): Promise<string | null>;
  now(): Date;
};

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

function profileResponse(profile: OwnProfile): Response {
  return privateJson({
    email: profile.email,
    nickname: profile.nickname,
    avatarKey: profile.avatarKey,
  });
}

function requireCanonicalOrigin(value: string): string {
  try {
    const origin = new URL(value).origin;
    if (origin !== value) throw new Error("Invalid canonical origin");
    return origin;
  } catch {
    throw new Error("Invalid canonical origin");
  }
}

async function parseBoundedJson(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumProfileBodyBytes)) {
    throw new RangeError("Profile request body is too large");
  }
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.byteLength;
    if (totalLength > maximumProfileBodyBytes) {
      await reader.cancel();
      throw new RangeError("Profile request body is too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
}

export function createAccountProfileRoute(dependencies: AccountProfileRouteDependencies) {
  const canonicalOrigin = requireCanonicalOrigin(dependencies.canonicalOrigin);
  return {
    async GET(_request: Request): Promise<Response> {
      try {
        const subject = await dependencies.getSubject();
        if (!subject) return privateJson({ error: "Sign in required" }, { status: 401 });

        const profile = await dependencies.getOwnProfile(subject);
        if (!profile) return privateJson({ error: "Profile unavailable" }, { status: 404 });
        return profileResponse(profile);
      } catch {
        return unavailableResponse();
      }
    },

    async PATCH(request: Request): Promise<Response> {
      if (request.headers.get("origin") !== canonicalOrigin) {
        return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
      }
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return Response.json({ error: "JSON request required" }, { status: 415 });
      }

      const subject = await dependencies.getSubject();
      if (!subject) return Response.json({ error: "Sign in required" }, { status: 401 });

      let body: unknown;
      try {
        body = await parseBoundedJson(request);
      } catch (error) {
        if (error instanceof RangeError) {
          return Response.json({ error: "Request body too large" }, { status: 413 });
        }
        return Response.json({ error: "Invalid request" }, { status: 400 });
      }
      const parsed = profileRequestSchema.safeParse(body);
      const nickname = parsed.success ? normalizeProfileNickname(parsed.data.nickname) : null;
      if (!parsed.success || !nickname) {
        return Response.json({ error: "Invalid profile" }, { status: 400 });
      }

      const now = dependencies.now();
      let rateLimitAttempt: RateLimitAttempt;
      try {
        rateLimitAttempt = await dependencies.takeRateLimitAttempt({
          keyHash: hashRateLimitKey(dependencies.rateLimitSecret, `nickname:${subject}`),
          kind: "nickname",
          now,
          windowMs: nicknameRateLimitWindowMs,
          limit: nicknameRateLimit,
        });
      } catch {
        return Response.json({ error: "Profile update unavailable" }, { status: 503 });
      }
      if (!rateLimitAttempt.allowed) {
        return Response.json(
          { error: "Profile update unavailable" },
          {
            status: 429,
            headers: { "retry-after": String(Math.max(1, Math.ceil(rateLimitAttempt.retryAfterMs / 1_000))) },
          },
        );
      }

      try {
        const profile = await dependencies.updateOwnProfile(subject, {
          nickname,
          avatarKey: parsed.data.avatarKey,
        });
        if (!profile) {
          return Response.json({ error: "Profile update unavailable" }, { status: 409 });
        }
        return profileResponse(profile);
      } catch {
        return Response.json({ error: "Profile update unavailable" }, { status: 409 });
      }
    },
  };
}

function unavailableResponse(): Response {
  return privateJson({ error: "Profile service unavailable" }, { status: 503 });
}

export function createAccountProfileProductionHandlers(
  dependencies: AccountProfileProductionDependencies,
) {
  async function createRoute() {
    const runtime = await dependencies.createRuntime();
    const store = runtime.accountStore;
    return createAccountProfileRoute({
      canonicalOrigin: runtime.canonicalOrigin,
      getSubject: dependencies.getSubject,
      getOwnProfile: (subject) => store.getOwnProfile(subject),
      updateOwnProfile: (subject, profile) => store.updateOwnProfile(subject, profile),
      takeRateLimitAttempt: (input) => store.takeRateLimitAttempt(input),
      rateLimitSecret: runtime.rateLimitSecret,
      now: dependencies.now,
    });
  }

  return {
    async GET(request: Request): Promise<Response> {
      try {
        return (await createRoute()).GET(request);
      } catch {
        return unavailableResponse();
      }
    },
    async PATCH(request: Request): Promise<Response> {
      try {
        return (await createRoute()).PATCH(request);
      } catch {
        return unavailableResponse();
      }
    },
  };
}

const productionHandlers = createAccountProfileProductionHandlers({
  createRuntime: () => createAccountRuntime(),
  getSubject: async () => {
    const { auth } = await import("../../../../auth");
    return (await auth())?.user?.id ?? null;
  },
  now: () => new Date(),
});

export const GET = productionHandlers.GET;
export const PATCH = productionHandlers.PATCH;
