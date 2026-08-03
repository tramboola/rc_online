import { isValidViewerId } from "../../viewer-id";
import { ViewerRegistry, viewerRegistry } from "../../viewer-registry";

type ViewerHeartbeatBody = {
  viewerId?: unknown;
};

export function createViewerPost(registry: ViewerRegistry) {
  return async function post(request: Request): Promise<Response> {
    let body: ViewerHeartbeatBody;

    try {
      body = (await request.json()) as ViewerHeartbeatBody;
    } catch {
      return Response.json({ error: "Invalid viewer ID" }, { status: 400 });
    }

    if (!isValidViewerId(body?.viewerId)) {
      return Response.json({ error: "Invalid viewer ID" }, { status: 400 });
    }

    return Response.json({ count: registry.heartbeat(body.viewerId) });
  };
}

export const POST = createViewerPost(viewerRegistry);
