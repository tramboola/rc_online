const TILT_DEADZONE_DEGREES = 3;
const TILT_FULL_SCALE_DEGREES = 25;
const SMOOTHING_FACTOR = 0.24;

export function mapTiltToSteering(tiltDegrees: number, centerDegrees: number): number {
  if (!Number.isFinite(tiltDegrees) || !Number.isFinite(centerDegrees)) return 0;
  const delta = tiltDegrees - centerDegrees;
  if (Math.abs(delta) <= TILT_DEADZONE_DEGREES) return 0;
  const adjusted = delta - Math.sign(delta) * TILT_DEADZONE_DEGREES;
  return clampAxis(adjusted / (TILT_FULL_SCALE_DEGREES - TILT_DEADZONE_DEGREES));
}

export function smoothAxis(current: number, target: number): number {
  return clampAxis(current + (clampAxis(target) - current) * SMOOTHING_FACTOR);
}

export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function mapThrottlePosition(offsetY: number, height: number): number {
  if (!Number.isFinite(offsetY) || !Number.isFinite(height) || height <= 0) return 0;
  const position = Math.max(0, Math.min(1, offsetY / height));
  return position <= 0.75
    ? clampAxis(1 - position / 0.75)
    : clampAxis(-(position - 0.75) / 0.25);
}

export function throttleAxisToTrackPercent(axis: number): number {
  const normalized = clampAxis(axis);
  return normalized >= 0 ? 75 * (1 - normalized) : 75 + 25 * -normalized;
}
