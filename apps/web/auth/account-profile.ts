export const defaultAvatarKey = "racer-red" as const;

export type SessionProfile = {
  nickname: string;
  avatarKey: string;
};

export function createDefaultNickname(userId: string, suffix?: number): string {
  const uuidPrefix = userId.replaceAll("-", "").slice(0, 8).toUpperCase();
  const baseNickname = `Driver-${uuidPrefix}`;
  return suffix === undefined ? baseNickname : `${baseNickname}-${suffix}`;
}
