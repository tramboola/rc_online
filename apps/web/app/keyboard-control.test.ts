import { describe, expect, it } from "vitest";

import {
  controlIntentFromPressedKeys,
  controlKeyForCode,
  updatePressedKeys,
} from "./keyboard-control";

describe("keyboard controls", () => {
  it("maps WASD, arrows, N, and Escape while leaving Space unmapped", () => {
    expect(controlKeyForCode("KeyW")).toBe("W");
    expect(controlKeyForCode("ArrowUp")).toBe("W");
    expect(controlKeyForCode("KeyA")).toBe("A");
    expect(controlKeyForCode("KeyS")).toBe("S");
    expect(controlKeyForCode("KeyD")).toBe("D");
    expect(controlKeyForCode("Space")).toBeNull();
    expect(controlKeyForCode("KeyN")).toBe("NITRO");
    expect(controlKeyForCode("Escape")).toBe("STOP");
    expect(controlKeyForCode("KeyQ")).toBeNull();
  });

  it("keeps held keys independent when one of two equivalent keys is released", () => {
    let pressed = updatePressedKeys(new Set(), "KeyW", true);
    pressed = updatePressedKeys(pressed, "ArrowUp", true);
    pressed = updatePressedKeys(pressed, "KeyW", false);

    expect(controlIntentFromPressedKeys(pressed).throttle).toBe(1);
  });

  it("neutralises opposing axes and ignores Space", () => {
    const pressed = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "Space"]);

    expect(controlIntentFromPressedKeys(pressed)).toEqual({
      steering: 0,
      throttle: 0,
      nitro: false,
    });
  });

  it("enables Nitro only while forward is held without reverse", () => {
    expect(controlIntentFromPressedKeys(new Set(["KeyW", "KeyN"])).nitro).toBe(true);
    expect(controlIntentFromPressedKeys(new Set(["KeyN"])).nitro).toBe(false);
    expect(controlIntentFromPressedKeys(new Set(["KeyW", "KeyS", "KeyN"])).nitro).toBe(false);
    expect(controlIntentFromPressedKeys(new Set(["KeyW", "KeyN", "Space"])).nitro).toBe(true);
  });
});
