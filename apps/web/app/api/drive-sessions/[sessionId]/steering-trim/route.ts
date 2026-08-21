import { z } from "zod";

import { createPostgresSteeringTrimStore } from "../../../../steering-trim-store";

const bodySchema = z.object({
  steeringTrimPercent: z.number().int().min(-20).max(20),
}).strict();
const paramsSchema = z.object({ sessionId: z.string().uuid() }).strict();

type RouteContext = { params: Promise<{ sessionId: string }> };

type SteeringTrimPatchDependencies = {
  getUserId(): Promise<string | null>;
  save(sessionId: string, userId: string, steeringTrimPercent: number, now: Date): Promise<boolean>;
  now(): Date;
};

function publicRequestOrigin(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  if ((forwardedProto === "http" || forwardedProto === "https") && forwardedHost) {
    try {
      return new URL(`${forwardedProto}://${forwardedHost}`).origin;
    } catch {
      // Fall back to the request URL when proxy headers are malformed.
    }
  }
  return new URL(request.url).origin;
}

export function createSteeringTrimPatch(dependencies: SteeringTrimPatchDependencies) {
  return async function patch(request: Request, context: RouteContext): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin && origin !== publicRequestOrigin(request)) {
      return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }

    const userId = await dependencies.getUserId();
    if (!userId) return Response.json({ error: "Sign in required" }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const parsedBody = bodySchema.safeParse(body);
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedBody.success || !parsedParams.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const saved = await dependencies.save(
      parsedParams.data.sessionId,
      userId,
      parsedBody.data.steeringTrimPercent,
      dependencies.now(),
    );
    if (!saved) {
      return Response.json({ error: "Drive session is no longer active" }, { status: 409 });
    }
    return Response.json({ steeringTrimPercent: parsedBody.data.steeringTrimPercent });
  };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return Response.json({ error: "Drive service unavailable" }, { status: 503 });

  const store = createPostgresSteeringTrimStore(databaseUrl);
  const { auth } = await import("../../../../../auth");
  return createSteeringTrimPatch({
    getUserId: async () => {
      const session = await auth();
      return session?.user?.id ?? null;
    },
    save: (sessionId, userId, steeringTrimPercent, now) => (
      store.save(sessionId, userId, steeringTrimPercent, now)
    ),
    now: () => new Date(),
  })(request, context);
}
