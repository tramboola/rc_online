export type AuthRuntimeEnvironment = {
  authEmailFrom: string;
  authRateLimitSecret: string;
  authSecret: string;
  authSupportEmail: string;
  authUrl: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  resendApiKey: string;
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
  if (parsedAuthUrl.protocol !== "https:" || parsedAuthUrl.origin !== authUrl) {
    throw new Error("AUTH_URL must be a canonical HTTPS origin");
  }

  return {
    authEmailFrom: required(env, "AUTH_EMAIL_FROM"),
    authRateLimitSecret: required(env, "AUTH_RATE_LIMIT_SECRET"),
    authSecret,
    authSupportEmail: required(env, "AUTH_SUPPORT_EMAIL"),
    authUrl,
    databaseUrl: required(env, "DATABASE_URL"),
    googleClientId: required(env, "GOOGLE_OAUTH_CLIENT_ID"),
    googleClientSecret: required(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
    resendApiKey: required(env, "RESEND_API_KEY"),
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
