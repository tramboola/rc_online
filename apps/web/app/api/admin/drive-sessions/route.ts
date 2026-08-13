import { z } from "zod";

import type { IceServer } from "@rc/contracts";

import { createPostgresDriveSessionStore } from "../../../drive-session-store";
import { createDriveSessionTicket, readPublicIceServers } from "../../../drive-session-ticket";

const requestSchema = z.object({ carId: z.string().uuid() }).strict();

type DriveSessionPostDependencies = {
  getUser(): Promise<{ id: string; role: "user" | "admin" } | null>;
  createSession(userId: string, carId: string, now: Date): Promise<{ sessionId: string; expiresAt: Date } | null>;
  now(): Date;
  ticketSecret: string;
  publicGatewayUrl: string;
  iceServers: IceServer[];
};

export function createDriveSessionPost(dependencies: DriveSessionPostDependencies) {
  return async function post(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
    const user = await dependencies.getUser();
    if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Administrator access required" }, { status: 403 });

    let parsed: ReturnType<typeof requestSchema.safeParse>;
    try {
      parsed = requestSchema.safeParse(await request.json());
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

    const now = dependencies.now();
    const session = await dependencies.createSession(user.id, parsed.data.carId, now);
    if (!session) return Response.json({ error: "Car unavailable" }, { status: 409 });
    const ticket = createDriveSessionTicket({
      userId: user.id,
      carId: parsed.data.carId,
      sessionId: session.sessionId,
      now,
      secret: dependencies.ticketSecret
    });
    return Response.json({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt.toISOString(),
      ticket,
      gatewayUrl: dependencies.publicGatewayUrl,
      iceServers: dependencies.iceServers
    }, { status: 201 });
  };
}

export async function POST(request: Request): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL;
  const ticketSecret = process.env.GATEWAY_SESSION_SECRET;
  const publicGatewayUrl = process.env.GATEWAY_PUBLIC_URL;
  if (!databaseUrl || !ticketSecret || !publicGatewayUrl) {
    return Response.json({ error: "Drive service unavailable" }, { status: 503 });
  }
  const store = createPostgresDriveSessionStore(databaseUrl);
  const { auth } = await import("../../../../auth");
  return createDriveSessionPost({
    getUser: async () => {
      const session = await auth();
      if (!session?.user?.id) return null;
      return { id: session.user.id, role: session.user.role === "admin" ? "admin" : "user" };
    },
    createSession: (userId, carId, now) => store.create(userId, carId, now),
    now: () => new Date(),
    ticketSecret,
    publicGatewayUrl,
    iceServers: readPublicIceServers()
  })(request);
}
