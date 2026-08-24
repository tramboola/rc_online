# Anonymous Viewer Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persistent localStorage viewer identifier and heartbeat API with an honest aggregate count of currently open anonymous gateway WebSocket connections.

**Architecture:** Add a dedicated unauthenticated `/v1/viewers` WebSocket upgrade path to the existing single gateway instance, isolated from authenticated drive/device sockets. The gateway stores only open socket references in memory and broadcasts `{ type: "viewer.count", count }`; the Next.js client reconnects with bounded backoff and never creates an identifier, cookie, or browser-storage entry.

**Tech Stack:** Fastify 5, `ws` 8, TypeScript 5.9, React 19, Vitest 4, Nginx WebSocket proxy.

**Spec:** `docs/superpowers/specs/2026-08-24-account-profile-privacy-design.md`

## Global Constraints

- The production topology has one gateway instance; multi-instance shared presence is outside this iteration.
- Viewer sockets accept no account/device identifier, authentication, signaling, vehicle-control, binary, or application payload.
- Do not persist IP addresses, user agents, connection IDs, or timestamps; the only state is the in-memory set of currently open sockets.
- Do not set cookies or use localStorage/sessionStorage.
- The UI must show unavailable when disconnected and reconnect with bounded exponential backoff.
- Preserve `/v1/socket` device/browser behavior and vehicle sessions unchanged.
- All commits use English messages. Do not stage the user's unrelated untracked plan files or `loading_page_imgs/`.

## File Structure

- `apps/gateway/src/viewer-presence.ts`: in-memory socket set and count broadcast.
- `apps/gateway/src/server.ts`: isolated `/v1/viewers` upgrade routing and lifecycle.
- `apps/web/app/viewer-socket-client.ts`: anonymous browser connection and message parser.
- `apps/web/app/use-viewer-count.ts`: React lifecycle and reconnect state.
- `apps/web/app/api/viewers/route.ts`, `viewer-client.ts`, `viewer-id.ts`, `viewer-registry.ts`: removed after replacement tests pass.
- `infra/nginx/rcmania.conf`: same-origin viewer WebSocket proxy if the existing gateway prefix does not already cover the new path.

---

### Task 1: Add isolated gateway viewer presence

**Files:**
- Create: `apps/gateway/src/viewer-presence.ts`
- Create: `apps/gateway/src/viewer-presence.test.ts`
- Modify: `apps/gateway/src/server.ts`
- Modify: `apps/gateway/src/server.test.ts`

**Interfaces:**
- Produces: `ViewerPresence.attach(socket: ViewerSocket): () => void`, `ViewerPresence.count: number`, and JSON message `{ v: 1, type: "viewer.count", count: number }`.

- [ ] **Step 1: Write failing presence tests**

```ts
it("broadcasts the number of currently open viewer sockets", () => {
  const presence = new ViewerPresence();
  const closeFirst = presence.attach(first);
  expect(lastMessage(first)).toEqual({ v: 1, type: "viewer.count", count: 1 });
  const closeSecond = presence.attach(second);
  expect(lastMessage(first)).toEqual({ v: 1, type: "viewer.count", count: 2 });
  closeFirst();
  expect(lastMessage(second)).toEqual({ v: 1, type: "viewer.count", count: 1 });
  closeSecond();
});
```

Also assert duplicate close is idempotent and failed/closed sockets are removed without retained metadata.

- [ ] **Step 2: Run the focused test and confirm red**

Run: `pnpm --filter @rc/gateway test -- src/viewer-presence.test.ts`

Expected: FAIL because `ViewerPresence` does not exist.

- [ ] **Step 3: Implement the minimal in-memory set**

Store only `Set<ViewerSocket>`. On attach and detach, broadcast the current integer to sockets with `readyState === OPEN`; remove any socket whose send throws. Do not log request headers.

- [ ] **Step 4: Add server upgrade isolation tests**

Assert `/v1/viewers` connects without auth, receives count, rejects binary/text payload with close code 4400, and cannot send `browser.authenticate`, signaling, control, or device messages. Assert `/v1/socket` still closes unauthenticated clients after the existing timeout.

- [ ] **Step 5: Route a second noServer WebSocket server**

Use `maxPayload: 256`, `perMessageDeflate: false`, no authentication timer, and a 45-second server ping/90-second stale close. Route by exact pathname; destroy all unknown upgrade paths.

- [ ] **Step 6: Run gateway tests and type checks**

Run: `pnpm --filter @rc/gateway test && pnpm --filter @rc/gateway typecheck`

Expected: PASS with existing drive/device tests unchanged.

- [ ] **Step 7: Commit gateway presence**

```bash
git add apps/gateway/src/viewer-presence.ts apps/gateway/src/viewer-presence.test.ts apps/gateway/src/server.ts apps/gateway/src/server.test.ts
git commit -m "Add anonymous gateway viewer presence"
```

### Task 2: Replace browser heartbeats with an anonymous viewer socket

**Files:**
- Create: `apps/web/app/viewer-socket-client.ts`
- Create: `apps/web/app/viewer-socket-client.test.ts`
- Modify: `apps/web/app/use-viewer-count.ts`
- Create: `apps/web/app/use-viewer-count.test.tsx`
- Delete: `apps/web/app/api/viewers/route.ts`
- Delete: `apps/web/app/api/viewers/route.test.ts`
- Delete: `apps/web/app/viewer-client.ts`
- Delete: `apps/web/app/viewer-client.test.ts`
- Delete: `apps/web/app/viewer-id.ts`
- Delete: `apps/web/app/viewer-registry.ts`
- Delete: `apps/web/app/viewer-registry.test.ts`

**Interfaces:**
- Consumes: gateway `/v1/viewers` message from Task 1.
- Produces: `connectViewerSocket(options): () => void` and hook state `{ count: number | null; status: "connecting" | "live" | "unavailable" }`.

- [ ] **Step 1: Write failing parser and lifecycle tests**

Assert valid non-negative integer count acceptance, malformed/negative/fractional message rejection, cleanup close, no send calls, no localStorage/sessionStorage access, and reconnect delays `1000, 2000, 4000, 8000, 15000` milliseconds capped at 15 seconds.

- [ ] **Step 2: Run focused tests and confirm red**

Run: `pnpm --filter @rc/web test -- app/viewer-socket-client.test.ts app/use-viewer-count.test.tsx`

Expected: FAIL because the socket client does not exist and the hook still sends heartbeats.

- [ ] **Step 3: Implement URL and message handling**

Build `wss://<current-host>/gateway/v1/viewers` on HTTPS and `ws://<current-host>/gateway/v1/viewers` in local HTTP development. Treat connection close/error as unavailable, reset retry attempt after a valid count, and ignore late callbacks after unmount.

- [ ] **Step 4: Replace the hook and UI unavailable state**

The existing home badge displays the integer only while `status === "live"`; otherwise display `— VIEWING NOW` without inventing a count.

- [ ] **Step 5: Delete persistent viewer identity/heartbeat code**

Remove the route and old modules listed above. Run `rg -n "rcmania_viewer_id|localStorage|sendViewerHeartbeat|ViewerRegistry|/api/viewers" apps/web` and require zero viewer-feature matches.

- [ ] **Step 6: Run web tests and type checks**

Run: `pnpm --filter @rc/web test -- app/viewer-socket-client.test.ts app/use-viewer-count.test.tsx app/home-presentation.test.ts app/simulation-screen.render.test.tsx && pnpm --filter @rc/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit browser replacement**

```bash
git add -A apps/web/app/api/viewers apps/web/app/viewer-client.ts apps/web/app/viewer-client.test.ts apps/web/app/viewer-id.ts apps/web/app/viewer-registry.ts apps/web/app/viewer-registry.test.ts apps/web/app/viewer-socket-client.ts apps/web/app/viewer-socket-client.test.ts apps/web/app/use-viewer-count.ts apps/web/app/use-viewer-count.test.tsx apps/web/app/home-presentation.test.ts apps/web/app/simulation-screen.render.test.tsx
git commit -m "Replace viewer heartbeats with live sockets"
```

### Task 3: Verify proxying, privacy, and release readiness

**Files:**
- Modify: `infra/nginx/rcmania.conf`
- Modify: `apps/gateway/src/infra.test.ts`
- Modify: `apps/web/app/viewer-socket-client.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: gateway and browser viewer presence.
- Produces: same-origin production routing and verification evidence; no deployment is performed.

- [ ] **Step 1: Write failing infrastructure assertions**

Assert Nginx forwards `/gateway/v1/viewers` to the gateway with HTTP/1.1 Upgrade/Connection headers and does not forward it to Next.js. Assert the gateway health endpoints and `/gateway/v1/socket` remain unchanged.

- [ ] **Step 2: Run focused tests and confirm red if routing is incomplete**

Run: `pnpm --filter @rc/gateway test -- src/infra.test.ts && pnpm --filter @rc/web test -- app/viewer-socket-client.test.ts`

Expected: PASS if the existing `/gateway/` location already covers the path; otherwise FAIL until the explicit location is added.

- [ ] **Step 3: Apply the minimum Nginx change**

Prefer the existing `/gateway/` upgrade location when it already rewrites to `/v1/viewers`. Add a dedicated exact/prefix location only if current rewrite semantics do not produce that upstream path. Keep rate and connection limits separate from authenticated drive sockets.

- [ ] **Step 4: Run privacy scans and full checks**

Run: `rg -n "rcmania_viewer_id|sendViewerHeartbeat|ViewerRegistry|/api/viewers" apps packages infra/nginx` and require zero matches. Run `pnpm --filter @rc/gateway test && pnpm --filter @rc/web test && pnpm --filter @rc/gateway build && pnpm --filter @rc/web build && pnpm check`.

Expected: all commands PASS.

- [ ] **Step 5: Commit proxy/documentation changes**

```bash
git add infra/nginx/rcmania.conf apps/gateway/src/infra.test.ts apps/web/app/viewer-socket-client.test.ts README.md
git commit -m "Route anonymous viewer presence"
```

- [ ] **Step 6: Stop before publication**

Present the commit list, fresh test/build output, browser-storage scan, and production smoke checklist. Obtain explicit user approval before pushing or updating the public VPS.
