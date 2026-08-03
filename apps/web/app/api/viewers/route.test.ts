import { expect, test } from "vitest";

import { ViewerRegistry } from "../../viewer-registry";
import { createViewerPost } from "./route";

test("POST records a heartbeat and returns the count", async () => {
  const post = createViewerPost(new ViewerRegistry());
  const response = await post(
    new Request("http://localhost/api/viewers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewerId: "browser-a" }),
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ count: 1 });
});

test("POST rejects invalid identifiers", async () => {
  const post = createViewerPost(new ViewerRegistry());
  const response = await post(
    new Request("http://localhost/api/viewers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewerId: "" }),
    }),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid viewer ID" });
});

test("POST rejects malformed JSON", async () => {
  const post = createViewerPost(new ViewerRegistry());
  const response = await post(
    new Request("http://localhost/api/viewers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid viewer ID" });
});
