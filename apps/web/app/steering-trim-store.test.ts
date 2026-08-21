import { describe, expect, it } from "vitest";

import { ACTIVE_DRIVE_SESSION_STATUSES } from "./steering-trim-store";

describe("steering trim store", () => {
  it("only accepts drive-session states that can still control a car", () => {
    expect(ACTIVE_DRIVE_SESSION_STATUSES).toEqual(["created", "negotiating", "active"]);
  });
});
