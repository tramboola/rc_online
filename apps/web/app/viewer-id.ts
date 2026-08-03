const viewerIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidViewerId(value: unknown): value is string {
  return typeof value === "string" && viewerIdPattern.test(value);
}
