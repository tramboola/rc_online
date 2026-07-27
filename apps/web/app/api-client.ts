const apiOrigin =
  process.env.NEXT_PUBLIC_API_ORIGIN ??
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "");

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": crypto.randomUUID(),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}
