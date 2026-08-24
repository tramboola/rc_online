export const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

export const sessionCookieName = "__Secure-authjs.session-token";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: sessionMaxAgeSeconds,
} as const;

export function createSessionCookie(token: string, expires: Date) {
  return {
    name: sessionCookieName,
    value: token,
    options: {
      ...sessionCookieOptions,
      expires,
    },
  } as const;
}
