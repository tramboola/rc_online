import { describe, expect, it } from "vitest";

import { KeyboardDriveModel } from "./keyboard-drive-model";

describe("keyboard reverse", () => {
  it.each([
    { elapsedMs: 0, throttle: -1 },
    { elapsedMs: 499, throttle: -1 },
    { elapsedMs: 500, throttle: -0.4 },
    { elapsedMs: 501, throttle: -0.4 },
    { elapsedMs: 5_000, throttle: -0.4 },
  ])("outputs $throttle at $elapsedMs ms without another key event", ({ elapsedMs, throttle }) => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyS"]), 100);

    expect(model.sample(100 + elapsedMs).throttle).toBe(throttle);
  });

  it.each([100, 600])("stops immediately when reverse is released after %i ms", (releaseMs) => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["ArrowDown"]), 0);

    expect(model.update(new Set(), releaseMs).throttle).toBe(0);
    expect(model.sample(2_000).throttle).toBe(0);
  });

  it("starts a fresh reverse boost after reverse is released and pressed again", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyS"]), 0);
    model.update(new Set(), 100);

    expect(model.update(new Set(["KeyS"]), 200).throttle).toBe(-1);
    expect(model.sample(699).throttle).toBe(-1);
    expect(model.sample(700).throttle).toBe(-0.4);
  });

  it("does not restart reverse boost on key repeat or while exchanging reverse aliases", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyS"]), 0);
    model.update(new Set(["KeyS"]), 250);
    model.update(new Set(["KeyS", "ArrowDown"]), 400);
    model.update(new Set(["ArrowDown"]), 499);

    expect(model.sample(500).throttle).toBe(-0.4);
    expect(model.update(new Set(["ArrowDown"]), 600).throttle).toBe(-0.4);
  });

  it("cancels reverse boost on contradictory throttle and restarts when reverse becomes effective", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyS"]), 0);

    expect(model.update(new Set(["KeyW", "KeyS", "KeyN"]), 400)).toEqual({
      steering: 0,
      throttle: 0,
      nitro: false,
    });
    expect(model.sample(1_000).throttle).toBe(0);
    expect(model.update(new Set(["KeyS"]), 1_100).throttle).toBe(-1);
    expect(model.sample(1_599).throttle).toBe(-1);
    expect(model.sample(1_600).throttle).toBe(-0.4);
  });
});

describe("keyboard steering", () => {
  it.each([
    { nitro: false, gasMs: 0, middleMs: 0, fullMs: 0, initial: 1, middle: 1 },
    { nitro: false, gasMs: 100, middleMs: 122.5, fullMs: 145, initial: 0, middle: 0.5 },
    { nitro: false, gasMs: 700, middleMs: 857.5, fullMs: 1_015, initial: 0, middle: 0.5 },
    { nitro: false, gasMs: 1_000, middleMs: 1_225, fullMs: 1_450, initial: 0, middle: 0.5 },
    { nitro: false, gasMs: 3_000, middleMs: 3_225, fullMs: 3_450, initial: 0, middle: 0.5 },
    { nitro: true, gasMs: 0, middleMs: 0, fullMs: 0, initial: 1, middle: 1 },
    { nitro: true, gasMs: 100, middleMs: 130, fullMs: 160, initial: 0, middle: 0.5 },
    { nitro: true, gasMs: 700, middleMs: 910, fullMs: 1_120, initial: 0, middle: 0.5 },
    { nitro: true, gasMs: 1_000, middleMs: 1_300, fullMs: 1_600, initial: 0, middle: 0.5 },
    { nitro: true, gasMs: 3_000, middleMs: 3_300, fullMs: 3_600, initial: 0, middle: 0.5 },
  ])("latches the turn ramp after $gasMs ms of gas with nitro=$nitro", ({ nitro, gasMs, middleMs, fullMs, initial, middle }) => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);

    const pressed = new Set(nitro ? ["KeyW", "KeyD", "KeyN"] : ["KeyW", "KeyD"]);
    expect(model.update(pressed, gasMs).steering).toBe(initial);
    expect(model.sample(middleMs).steering).toBeCloseTo(middle);
    if (fullMs > gasMs) expect(model.sample(fullMs - 0.001).steering).toBeLessThan(1);
    expect(model.sample(fullMs).steering).toBe(1);
    expect(model.sample(10_000).steering).toBe(1);
  });

  it("applies the same ramp with a negative sign when steering left", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["ArrowUp"]), 0);

    expect(model.update(new Set(["ArrowUp", "ArrowLeft"]), 3_000).steering).toBe(0);
    expect(model.sample(3_225).steering).toBe(-0.5);
    expect(model.sample(3_450).steering).toBe(-1);
  });

  it.each([
    ["KeyA"],
    ["KeyS", "KeyA"],
    ["KeyW", "KeyS", "KeyA"],
    ["KeyN", "KeyA"],
  ])("steers fully without effective forward gas: %j", (...codes) => {
    const model = new KeyboardDriveModel();

    expect(model.update(new Set(codes), 1_000).steering).toBe(-1);
    expect(model.sample(2_000).steering).toBe(-1);
  });

  it("preserves both gas and turn hold times across repeats and alias changes", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW"]), 300);
    model.update(new Set(["KeyW", "ArrowUp"]), 400);
    model.update(new Set(["ArrowUp"]), 600);
    model.update(new Set(["ArrowUp", "KeyD"]), 700);

    expect(model.update(new Set(["ArrowUp", "KeyD"]), 778.75).steering).toBe(0.25);
    expect(model.update(new Set(["ArrowUp", "KeyD", "ArrowRight"]), 857.5).steering).toBe(0.5);
    expect(model.update(new Set(["ArrowUp", "ArrowRight"]), 936.25).steering).toBe(0.75);
    expect(model.sample(1_015).steering).toBe(1);
  });

  it("keeps steering full after forward release even if gas is pressed again mid-turn", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyD"]), 3_000);
    expect(model.sample(3_112.5).steering).toBe(0.25);

    expect(model.update(new Set(["KeyD"]), 3_150).steering).toBe(1);
    expect(model.update(new Set(["KeyW", "KeyD"]), 3_200).steering).toBe(1);
    expect(model.sample(3_300).steering).toBe(1);
  });

  it("keeps an already held turn full when forward gas begins", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyA"]), 0);

    expect(model.update(new Set(["KeyW", "KeyA"]), 1_000).steering).toBe(-1);
    expect(model.sample(1_300).steering).toBe(-1);
  });

  it("neutralises a released turn immediately and restarts its next press from neutral", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyD"]), 3_000);
    expect(model.sample(3_112.5).steering).toBe(0.25);

    expect(model.update(new Set(["KeyW"]), 3_150).steering).toBe(0);
    expect(model.sample(4_000).steering).toBe(0);
    expect(model.update(new Set(["KeyW", "KeyD"]), 4_200).steering).toBe(0);
    expect(model.sample(4_425).steering).toBe(0.5);
  });

  it("starts an opposite turn from neutral instead of carrying the previous angle", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyD"]), 3_000);
    expect(model.sample(3_225).steering).toBe(0.5);

    expect(model.update(new Set(["KeyW", "KeyA"]), 3_300).steering).toBe(0);
    expect(model.sample(3_525).steering).toBe(-0.5);
  });

  it("cancels contradictory steering and starts a fresh ramp when one direction remains", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyA"]), 3_000);
    expect(model.sample(3_225).steering).toBe(-0.5);

    expect(model.update(new Set(["KeyW", "KeyA", "KeyD"]), 3_300).steering).toBe(0);
    expect(model.sample(4_000).steering).toBe(0);
    expect(model.update(new Set(["KeyW", "KeyD"]), 4_100).steering).toBe(0);
    expect(model.sample(4_325).steering).toBe(0.5);
  });

  it("restarts the gas hold after contradictory throttle becomes effective forward again", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyS"]), 1_000);
    model.update(new Set(["KeyW"]), 1_100);

    expect(model.update(new Set(["KeyW", "KeyD"]), 1_200).steering).toBe(0);
    expect(model.sample(1_222.5).steering).toBe(0.5);
    expect(model.sample(1_245).steering).toBe(1);
  });

  it("keeps a normal turn on its 450 ms ramp when Nitro is pressed mid-turn", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyD"]), 1_000);

    expect(model.update(new Set(["KeyW", "KeyD", "KeyN"]), 1_225)).toEqual({
      steering: 0.5, throttle: 1, nitro: true,
    });
    expect(model.sample(1_450).steering).toBe(1);
    model.update(new Set(["KeyW", "KeyN"]), 1_500);
    model.update(new Set(["KeyW", "KeyN", "KeyD"]), 1_600);
    expect(model.sample(1_900).steering).toBe(0.5);
    expect(model.sample(2_200).steering).toBe(1);
  });

  it("keeps a Nitro turn on its 600 ms ramp when N is released mid-turn", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW", "KeyN"]), 0);
    model.update(new Set(["KeyW", "KeyN", "KeyA"]), 1_000);

    expect(model.update(new Set(["KeyW", "KeyA"]), 1_300)).toEqual({
      steering: -0.5, throttle: 1, nitro: false,
    });
    expect(model.sample(1_600).steering).toBe(-1);
    model.update(new Set(["KeyW", "KeyD"]), 1_700);
    expect(model.sample(1_925).steering).toBe(0.5);
    expect(model.sample(2_150).steering).toBe(1);
  });

  it("does not restart forward hold when Nitro is enabled before a turn", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyN"]), 700);
    model.update(new Set(["KeyW", "KeyN", "KeyD"]), 1_000);
    expect(model.sample(1_300).steering).toBe(0.5);
    expect(model.sample(1_600).steering).toBe(1);
  });

  it("makes a held Nitro turn full immediately on gas release, even if N remains pressed", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW", "KeyN"]), 0);
    model.update(new Set(["KeyW", "KeyN", "KeyA"]), 1_000);
    expect(model.sample(1_150).steering).toBe(-0.25);
    expect(model.update(new Set(["KeyN", "KeyA"]), 1_150)).toEqual({
      steering: -1, throttle: 0, nitro: false,
    });
    expect(model.update(new Set(["KeyW", "KeyN", "KeyA"]), 1_200).steering).toBe(-1);
  });
});

describe("keyboard drive lifecycle", () => {
  it.each([
    { codes: ["KeyW"], throttle: 1, nitro: false },
    { codes: ["ArrowUp", "KeyN"], throttle: 1, nitro: true },
    { codes: ["KeyN"], throttle: 0, nitro: false },
    { codes: ["KeyS", "KeyN"], throttle: -1, nitro: false },
    { codes: ["KeyW", "KeyS", "KeyN"], throttle: 0, nitro: false },
    { codes: ["Space", "Escape"], throttle: 0, nitro: false },
  ])("preserves existing forward and nitro behavior for $codes", ({ codes, throttle, nitro }) => {
    const model = new KeyboardDriveModel();

    expect(model.update(new Set(codes), 0)).toEqual({ steering: 0, throttle, nitro });
  });

  it("clears a pending reverse window on reset without resurrecting it later", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyS"]), 0);
    model.sample(499);
    model.reset();

    expect(model.sample(500)).toEqual({ steering: 0, throttle: 0, nitro: false });
    expect(model.sample(5_000)).toEqual({ steering: 0, throttle: 0, nitro: false });
    expect(model.update(new Set(["KeyS"]), 5_100).throttle).toBe(-1);
    expect(model.sample(5_599).throttle).toBe(-1);
    expect(model.sample(5_600).throttle).toBe(-0.4);
  });

  it("clears steering, forward hold, nitro and the clock baseline on reset", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW", "KeyN"]), 0);
    model.update(new Set(["KeyW", "KeyN", "KeyD"]), 3_000);
    expect(model.sample(3_300)).toEqual({ steering: 0.5, throttle: 1, nitro: true });
    model.reset();

    expect(model.sample(0)).toEqual({ steering: 0, throttle: 0, nitro: false });
    model.update(new Set(["KeyW"]), 0);
    expect(model.update(new Set(["KeyW", "KeyD"]), 100).steering).toBe(0);
    expect(model.sample(122.5).steering).toBe(0.5);
    expect(model.sample(145).steering).toBe(1);
  });

  it("starts neutral and remains neutral when reset is repeated", () => {
    const model = new KeyboardDriveModel();
    expect(model.sample(0)).toEqual({ steering: 0, throttle: 0, nitro: false });
    model.reset();
    model.reset();

    expect(model.sample(10_000)).toEqual({ steering: 0, throttle: 0, nitro: false });
  });

  it("does not read subsequent mutations of the caller's pressed-key set until update", () => {
    const model = new KeyboardDriveModel();
    const pressed = new Set(["KeyW", "KeyN"]);
    model.update(pressed, 0);
    pressed.clear();

    expect(model.sample(100)).toEqual({ steering: 0, throttle: 1, nitro: true });
    expect(model.update(pressed, 100)).toEqual({ steering: 0, throttle: 0, nitro: false });
  });
});

describe("keyboard drive clock safety", () => {
  it.each([
    { label: "NaN", nowMs: Number.NaN },
    { label: "positive infinity", nowMs: Number.POSITIVE_INFINITY },
    { label: "negative infinity", nowMs: Number.NEGATIVE_INFINITY },
    { label: "backward time", nowMs: 100 },
  ])("freezes turn progress for $label instead of producing invalid or regressed output", ({ nowMs }) => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.update(new Set(["KeyW", "KeyD"]), 3_000);
    expect(model.sample(3_225).steering).toBe(0.5);

    expect(model.sample(nowMs).steering).toBe(0.5);
    expect(model.sample(3_450).steering).toBe(1);
  });

  it("does not re-enter reverse boost when a sampled time moves backward", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyS"]), 0);
    expect(model.sample(600).throttle).toBe(-0.4);

    expect(model.sample(100).throttle).toBe(-0.4);
    expect(model.sample(Number.NaN).throttle).toBe(-0.4);
  });

  it("uses the latest sampled time when a key event supplies a stale timestamp", () => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), 0);
    model.sample(3_000);

    expect(model.update(new Set(["KeyW", "KeyD"]), 100).steering).toBe(0);
    expect(model.sample(3_225).steering).toBe(0.5);
  });

  it.each([
    { label: "NaN", nowMs: Number.NaN },
    { label: "positive infinity", nowMs: Number.POSITIVE_INFINITY },
    { label: "negative infinity", nowMs: Number.NEGATIVE_INFINITY },
    { label: "negative time", nowMs: -1_000 },
  ])("starts the clock at zero when the first update receives $label", ({ nowMs }) => {
    const model = new KeyboardDriveModel();
    model.update(new Set(["KeyW"]), nowMs);

    expect(model.update(new Set(["KeyW", "KeyD"]), 100).steering).toBe(0);
    expect(model.sample(122.5).steering).toBe(0.5);
    expect(model.sample(145).steering).toBe(1);
  });
});
