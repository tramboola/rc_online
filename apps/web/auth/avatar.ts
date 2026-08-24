export const avatarKeys = [
  "racer-red",
  "racer-cyan",
  "wheel-fire",
  "track-night",
  "buggy-red",
  "helmet-lime",
] as const;

export type AvatarKey = (typeof avatarKeys)[number];

const avatarKeySet = new Set<string>(avatarKeys);
const reservedNicknameSet = new Set([
  "admin",
  "administrator",
  "moderator",
  "support",
  "rcmania",
  "rc mania",
  "system",
  "deleted driver",
]);

export function isAvatarKey(value: unknown): value is AvatarKey {
  return typeof value === "string" && avatarKeySet.has(value);
}

export function normalizeProfileNickname(value: string): string | null {
  const normalizedValue = value.normalize("NFKC");
  if (/\p{C}/u.test(normalizedValue)) {
    return null;
  }
  const nickname = normalizedValue.trim();
  const codePoints = Array.from(nickname);
  if (
    codePoints.length < 3
    || codePoints.length > 24
    || reservedNicknameSet.has(nickname.toLowerCase())
  ) {
    return null;
  }
  return nickname;
}
