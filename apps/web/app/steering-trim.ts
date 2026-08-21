export type SteeringTrimFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function normalizeSteeringTrim(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Steering trim must be finite");
  return Math.max(-20, Math.min(20, Math.round(value)));
}

export async function saveSteeringTrim(
  sessionId: string,
  value: number,
  fetcher: SteeringTrimFetcher = fetch,
): Promise<number> {
  const steeringTrimPercent = normalizeSteeringTrim(value);
  const response = await fetcher(
    `/api/drive-sessions/${encodeURIComponent(sessionId)}/steering-trim`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steeringTrimPercent }),
    },
  );
  if (!response.ok) throw new Error("Could not save steering trim");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Steering trim response was invalid");
  }
  const saved = (body as { steeringTrimPercent?: unknown } | null)?.steeringTrimPercent;
  if (typeof saved !== "number" || normalizeSteeringTrim(saved) !== saved) {
    throw new Error("Steering trim response was invalid");
  }
  return saved;
}
