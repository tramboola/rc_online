import { getPostgresLiveQueueStore, type LiveQueueSnapshot } from "../../live-queue-store";

type QueueHandlersDependencies = {
  getUser(): Promise<{ id: string } | null>;
  join(userId: string, now: Date): Promise<LiveQueueSnapshot>;
  read(userId: string, now: Date): Promise<LiveQueueSnapshot>;
  leave(userId: string, now: Date): Promise<void>;
  now(): Date;
};

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  if ((forwardedProto === "http" || forwardedProto === "https") && forwardedHost) {
    try {
      return origin === new URL(`${forwardedProto}://${forwardedHost}`).origin;
    } catch {
      return false;
    }
  }
  return origin === new URL(request.url).origin;
}

export function createQueueHandlers(dependencies: QueueHandlersDependencies) {
  async function user(): Promise<{ id: string } | Response> {
    return (await dependencies.getUser()) ?? Response.json({ error: "Sign in required" }, { status: 401 });
  }
  return {
    GET: async (_request: Request) => {
      const authenticated = await user();
      if (authenticated instanceof Response) return authenticated;
      return Response.json(await dependencies.read(authenticated.id, dependencies.now()));
    },
    POST: async (request: Request) => {
      if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
      const authenticated = await user();
      if (authenticated instanceof Response) return authenticated;
      return Response.json(await dependencies.join(authenticated.id, dependencies.now()));
    },
    DELETE: async (request: Request) => {
      if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
      const authenticated = await user();
      if (authenticated instanceof Response) return authenticated;
      await dependencies.leave(authenticated.id, dependencies.now());
      return new Response(null, { status: 204 });
    },
  };
}

async function productionHandlers() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  const store = getPostgresLiveQueueStore(databaseUrl);
  const { auth } = await import("../../../auth");
  return createQueueHandlers({
    getUser: async () => {
      const session = await auth();
      return session?.user?.id ? { id: session.user.id } : null;
    },
    join: (userId, now) => store.join(userId, now),
    read: (userId, now) => store.read(userId, now),
    leave: (userId, now) => store.leave(userId, now),
    now: () => new Date(),
  });
}

export async function GET(request: Request) {
  const handlers = await productionHandlers();
  return handlers ? handlers.GET(request) : Response.json({ error: "Queue unavailable" }, { status: 503 });
}

export async function POST(request: Request) {
  const handlers = await productionHandlers();
  return handlers ? handlers.POST(request) : Response.json({ error: "Queue unavailable" }, { status: 503 });
}

export async function DELETE(request: Request) {
  const handlers = await productionHandlers();
  return handlers ? handlers.DELETE(request) : Response.json({ error: "Queue unavailable" }, { status: 503 });
}
