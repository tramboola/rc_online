export const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

export type SessionCookieRuntime = "production" | "development" | "test";

export function createSessionCookieDefinition(runtime: SessionCookieRuntime) {
  const secure = runtime === "production";
  return {
    name: `${secure ? "__Secure-" : ""}authjs.session-token`,
    options: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    },
  } as const;
}

const runtime = process.env.NODE_ENV === "production"
  ? "production"
  : process.env.NODE_ENV === "test"
    ? "test"
    : "development";
const sessionCookieDefinition = createSessionCookieDefinition(runtime);

export const sessionCookieName = sessionCookieDefinition.name;
export const sessionCookieOptions = sessionCookieDefinition.options;

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

export function createClearedSessionCookie() {
  return {
    name: sessionCookieName,
    value: "",
    options: {
      ...sessionCookieOptions,
      maxAge: 0,
      expires: new Date(0),
    },
  } as const;
}
