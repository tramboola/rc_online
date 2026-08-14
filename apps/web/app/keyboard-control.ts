export type DriveKey = "W" | "A" | "S" | "D" | "BRAKE" | "NITRO" | "STOP";

export interface KeyboardControlIntent {
  readonly steering: -1 | 0 | 1;
  readonly throttle: -1 | 0 | 1;
  readonly brake: boolean;
  readonly nitro: boolean;
}

const CODE_TO_KEY = new Map<string, DriveKey>([
  ["KeyW", "W"],
  ["ArrowUp", "W"],
  ["KeyA", "A"],
  ["ArrowLeft", "A"],
  ["KeyS", "S"],
  ["ArrowDown", "S"],
  ["KeyD", "D"],
  ["ArrowRight", "D"],
  ["Space", "BRAKE"],
  ["KeyN", "NITRO"],
  ["Escape", "STOP"],
]);

export function controlKeyForCode(code: string): DriveKey | null {
  return CODE_TO_KEY.get(code) ?? null;
}

export function updatePressedKeys(
  current: ReadonlySet<string>,
  code: string,
  pressed: boolean,
): ReadonlySet<string> {
  const next = new Set(current);
  if (pressed) next.add(code);
  else next.delete(code);
  return next;
}

export function controlIntentFromPressedKeys(
  pressed: ReadonlySet<string>,
): KeyboardControlIntent {
  const has = (key: DriveKey) =>
    [...pressed].some((code) => controlKeyForCode(code) === key);
  const left = has("A");
  const right = has("D");
  const forward = has("W");
  const reverse = has("S");
  const brake = has("BRAKE");
  const steering: -1 | 0 | 1 = left === right ? 0 : left ? -1 : 1;
  const throttle: -1 | 0 | 1 = forward === reverse ? 0 : forward ? 1 : -1;

  return {
    steering,
    throttle,
    brake,
    nitro: forward && !reverse && !brake && has("NITRO"),
  };
}

export function isDriveKeyActive(
  pressed: ReadonlySet<string>,
  key: Exclude<DriveKey, "STOP">,
): boolean {
  return [...pressed].some((code) => controlKeyForCode(code) === key);
}
