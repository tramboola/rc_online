export type UserRole = "user" | "admin";

export function normalizeUserRole(value: string | null | undefined): UserRole {
  return value === "admin" ? "admin" : "user";
}
