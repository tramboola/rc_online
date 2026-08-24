import { describe, expect, it } from "vitest";

import { ViewerPresence, sweepViewerPings, type ViewerHeartbeatSocket, type ViewerSocket } from "./viewer-presence.js";

class FakeViewerSocket implements ViewerSocket {
  readonly OPEN = 1;

  readonly sent: string[] = [];
  readyState = this.OPEN;
  throwOnSend = false;

  send(message: string): void {
    if (this.throwOnSend) throw new Error("connection lost");
    this.sent.push(message);
  }
}

class FakeHeartbeatSocket implements ViewerHeartbeatSocket {
  readonly pings: number[] = [];
  readonly closes: Array<[number, string]> = [];

  ping(): void {
    this.pings.push(1);
  }

  close(code: number, reason: string): void {
    this.closes.push([code, reason]);
  }
}

const count = (value: number) => JSON.stringify({ v: 1, type: "viewer.count", count: value });

describe("ViewerPresence", () => {
  it("broadcasts the live count when viewers attach and detach", () => {
    const presence = new ViewerPresence();
    const first = new FakeViewerSocket();
    const second = new FakeViewerSocket();

    const detachFirst = presence.attach(first);
    const detachSecond = presence.attach(second);
    detachFirst();
    detachSecond();

    expect(first.sent).toEqual([count(1), count(2)]);
    expect(second.sent).toEqual([count(2), count(1)]);
    expect(presence.count).toBe(0);
  });

  it("does not rebroadcast when the same detach function is called twice", () => {
    const presence = new ViewerPresence();
    const viewer = new FakeViewerSocket();
    const detach = presence.attach(viewer);

    detach();
    detach();

    expect(viewer.sent).toEqual([count(1)]);
    expect(presence.count).toBe(0);
  });

  it("skips closed viewers and removes viewers whose count send fails", () => {
    const presence = new ViewerPresence();
    const closed = new FakeViewerSocket();
    closed.readyState = 3;
    const broken = new FakeViewerSocket();
    broken.throwOnSend = true;
    const open = new FakeViewerSocket();

    presence.attach(closed);
    presence.attach(broken);
    presence.attach(open);

    expect(closed.sent).toEqual([]);
    expect(broken.sent).toEqual([]);
    expect(open.sent).toEqual([count(2)]);
    expect(presence.count).toBe(2);
  });

  it("pings viewers every sweep and closes viewers that miss the next pong window", () => {
    const responsive = new FakeHeartbeatSocket();
    const unresponsive = new FakeHeartbeatSocket();
    const alive = new WeakSet<ViewerHeartbeatSocket>([responsive, unresponsive]);

    sweepViewerPings([responsive, unresponsive], alive);
    alive.add(responsive);
    sweepViewerPings([responsive, unresponsive], alive);

    expect(responsive.pings).toEqual([1, 1]);
    expect(unresponsive.pings).toEqual([1]);
    expect(unresponsive.closes).toEqual([[4408, "viewer pong timeout"]]);
  });
});
