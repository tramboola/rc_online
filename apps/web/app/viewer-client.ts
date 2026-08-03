import { isValidViewerId } from "./viewer-id";

type ViewerStorage = Pick<Storage, "getItem" | "setItem">;
type ViewerFetcher = (input: string, init: RequestInit) => Promise<Response>;

export const viewerIdStorageKey = "rcmania_viewer_id";

export function createViewerId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `viewer_${token}`;
}

export function getOrCreateViewerId(
  storage: ViewerStorage | null,
  createId: () => string = createViewerId,
): string {
  try {
    const storedViewerId = storage?.getItem(viewerIdStorageKey);
    if (isValidViewerId(storedViewerId)) {
      return storedViewerId;
    }
  } catch {
    // Storage can be blocked by browser privacy settings; use an ephemeral ID.
  }

  const viewerId = createId();

  try {
    storage?.setItem(viewerIdStorageKey, viewerId);
  } catch {
    // The in-memory ID still provides an honest count for this page lifetime.
  }

  return viewerId;
}

export async function sendViewerHeartbeat(
  viewerId: string,
  fetcher: ViewerFetcher = fetch,
): Promise<number> {
  const response = await fetcher("/api/viewers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewerId }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Viewer heartbeat failed");
  }

  const body = (await response.json()) as { count?: unknown };
  if (!Number.isInteger(body.count) || (body.count as number) < 0) {
    throw new Error("Invalid viewer count response");
  }

  return body.count as number;
}
