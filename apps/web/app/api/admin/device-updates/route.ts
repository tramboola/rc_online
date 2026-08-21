import { z } from "zod";

import {
  createPostgresDeviceUpdateStore,
  type DeviceUpdateRequestResult,
  type DeviceUpdateSummary,
} from "../../../device-update-store";

const bodySchema = z.object({
  carId: z.string().uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
}).strict();
const querySchema = z.string().uuid();

type Dependencies = {
  getUser(): Promise<{ id: string; role: "user" | "admin" } | null>;
  requestUpdate(adminId: string, carId: string, version: string, now: Date): Promise<DeviceUpdateRequestResult>;
  getLatest(carId: string): Promise<DeviceUpdateSummary | null>;
  now(): Date;
};

function publicOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  if ((proto === "http" || proto === "https") && host) {
    try { return new URL(`${proto}://${host}`).origin; } catch { /* use request URL */ }
  }
  return new URL(request.url).origin;
}

async function authorize(request: Request, dependencies: Dependencies) {
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin(request)) return { response: Response.json({ error: "Cross-origin request rejected" }, { status: 403 }) };
  const user = await dependencies.getUser();
  if (!user) return { response: Response.json({ error: "Sign in required" }, { status: 401 }) };
  if (user.role !== "admin") return { response: Response.json({ error: "Administrator access required" }, { status: 403 }) };
  return { user };
}

export function createDeviceUpdateHandlers(dependencies: Dependencies) {
  return {
    POST: async (request: Request): Promise<Response> => {
      const auth = await authorize(request, dependencies);
      if ("response" in auth) return auth.response;
      let data: unknown;
      try { data = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
      const parsed = bodySchema.safeParse(data);
      if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
      const result = await dependencies.requestUpdate(auth.user.id, parsed.data.carId, parsed.data.version, dependencies.now());
      if (result.kind === "not_found") return Response.json({ error: "Car or release not found" }, { status: 404 });
      if (result.kind === "conflict") return Response.json({ error: "Car or update is busy" }, { status: 409 });
      return Response.json({ updateId: result.updateId }, { status: 201 });
    },
    GET: async (request: Request): Promise<Response> => {
      const auth = await authorize(request, dependencies);
      if ("response" in auth) return auth.response;
      const carId = querySchema.safeParse(new URL(request.url).searchParams.get("carId"));
      if (!carId.success) return Response.json({ error: "Invalid carId" }, { status: 400 });
      const latest = await dependencies.getLatest(carId.data);
      return latest
        ? Response.json({ ...latest, requestedAt: latest.requestedAt.toISOString(), startedAt: latest.startedAt?.toISOString() ?? null, finishedAt: latest.finishedAt?.toISOString() ?? null })
        : Response.json({ error: "Update not found" }, { status: 404 });
    },
  };
}

async function productionDependencies(): Promise<Dependencies | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  const store = createPostgresDeviceUpdateStore(databaseUrl);
  const { auth } = await import("../../../../auth");
  return {
    getUser: async () => {
      const session = await auth();
      if (!session?.user?.id) return null;
      return { id: session.user.id, role: session.user.role === "admin" ? "admin" : "user" };
    },
    requestUpdate: (adminId, carId, version, now) => store.requestDeviceUpdate(adminId, carId, version, now),
    getLatest: (carId) => store.getLatestDeviceUpdate(carId),
    now: () => new Date(),
  };
}

export async function POST(request: Request): Promise<Response> {
  const dependencies = await productionDependencies();
  return dependencies
    ? createDeviceUpdateHandlers(dependencies).POST(request)
    : Response.json({ error: "Update service unavailable" }, { status: 503 });
}

export async function GET(request: Request): Promise<Response> {
  const dependencies = await productionDependencies();
  return dependencies
    ? createDeviceUpdateHandlers(dependencies).GET(request)
    : Response.json({ error: "Update service unavailable" }, { status: 503 });
}
