import { z } from "zod";

import type { IceServer } from "@rc/contracts";

import { createPostgresDriveSessionStore } from "../../../drive-session-store";
import { createDriveSessionTicket, createPublicIceServers, readIceTransportPolicy } from "../../../drive-session-ticket";

const requestSchema = z.object({ carId: z.string().uuid() }).strict();

type DriveSessionPostDependencies = {
  getUser(): Promise<{ id: string; role: "user" | "admin" } | null>;
  createSession(userId: string, carId: string, now: Date): Promise<{ sessionId: string; expiresAt: Date } | null>;
  now(): Date;
  ticketSecret: string;
  publicGatewayUrl: string;
  createIceServers(subject: string, now: Date): IceServer[];
  iceTransportPolicy: "all" | "relay";
};

function getPublicRequestOrigin(request: Request): string {
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

export function createDriveSessionPost(dependencies: DriveSessionPostDependencies) {
  return async function post(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin && origin !== getPublicRequestOrigin(request)) {
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
      iceTransportPolicy: dependencies.iceTransportPolicy,
      iceServers: dependencies.createIceServers(session.sessionId, now)
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
    iceTransportPolicy: readIceTransportPolicy(),
    createIceServers: (subject, now) => createPublicIceServers(subject, now)
  })(request);
}
