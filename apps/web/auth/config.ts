export type AuthRuntimeEnvironment = {
  authSecret: string;
  authUrl: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
};

function required(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required auth environment variable: ${key}`);
  }
  return value;
}

export function readAuthRuntimeEnvironment(
  env: Record<string, string | undefined>,
): AuthRuntimeEnvironment {
  const authSecret = required(env, "AUTH_SECRET");
  if (authSecret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }

  const authUrl = required(env, "AUTH_URL");
  const parsedAuthUrl = new URL(authUrl);
  const isLocalDevelopment = parsedAuthUrl.hostname === "localhost";
  if (parsedAuthUrl.origin !== authUrl || (
    parsedAuthUrl.protocol !== "https:" && !isLocalDevelopment
  )) {
    throw new Error("AUTH_URL must be an HTTPS origin");
  }

  return {
    authSecret,
    authUrl,
    databaseUrl: required(env, "DATABASE_URL"),
    googleClientId: required(env, "GOOGLE_OAUTH_CLIENT_ID"),
    googleClientSecret: required(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
  };
}

export function sanitizeReturnPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return "/";
  }
  return value;
}
