export type AuthRuntimeEnvironment = {
  authEmailFrom: string | undefined;
  authRateLimitSecret: string;
  authSecret: string;
  authSupportEmail: string | undefined;
  authUrl: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  resendApiKey: string | undefined;
};

const plainEmailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/iu;

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

function optional(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return env[key]?.trim() || undefined;
}

function untrimmedOptional(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key];
  return value?.trim() ? value : undefined;
}

function untrimmedRequired(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = untrimmedOptional(env, key);
  if (!value) {
    throw new Error(`Missing required auth environment variable: ${key}`);
  }
  return value;
}

export function requirePlainEmailAddress(value: string, key: string): string {
  const normalized = value.trim();
  if (
    normalized !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
    || !plainEmailPattern.test(normalized)
  ) {
    throw new Error(`${key} must be one plain email address`);
  }
  return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function readAuthRuntimeEnvironment(
  env: Record<string, string | undefined>,
): AuthRuntimeEnvironment {
  const authSecret = required(env, "AUTH_SECRET");
  if (authSecret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }

  const rawRateLimitSecret = untrimmedRequired(env, "AUTH_RATE_LIMIT_SECRET");
  if (!/^[a-f0-9]{64}$/iu.test(rawRateLimitSecret)) {
    throw new Error(
      "AUTH_RATE_LIMIT_SECRET must be a 32-byte key encoded as 64 hexadecimal characters",
    );
  }
  const authRateLimitSecret = rawRateLimitSecret.toLowerCase();

  const authUrl = required(env, "AUTH_URL");
  let parsedAuthUrl: URL;
  try {
    parsedAuthUrl = new URL(authUrl);
  } catch {
    throw new Error("AUTH_URL must be a canonical HTTPS origin");
  }
  const isProduction = env.NODE_ENV === "production";
  const isCanonicalOrigin = parsedAuthUrl.origin === authUrl;
  const isHttps = parsedAuthUrl.protocol === "https:";
  const isLocalHttp = parsedAuthUrl.protocol === "http:"
    && isLoopbackHostname(parsedAuthUrl.hostname);
  if (!isCanonicalOrigin || (isProduction ? !isHttps : !(isHttps || isLocalHttp))) {
    throw new Error(isProduction
      ? "AUTH_URL must be a canonical HTTPS origin"
      : "AUTH_URL must be a canonical HTTPS or loopback HTTP origin");
  }

  const resendApiKey = isProduction
    ? required(env, "RESEND_API_KEY")
    : optional(env, "RESEND_API_KEY");
  const authEmailFrom = isProduction
    ? required(env, "AUTH_EMAIL_FROM")
    : optional(env, "AUTH_EMAIL_FROM");
  const rawSupportEmail = isProduction
    ? untrimmedRequired(env, "AUTH_SUPPORT_EMAIL")
    : untrimmedOptional(env, "AUTH_SUPPORT_EMAIL");
  const authSupportEmail = rawSupportEmail
    ? requirePlainEmailAddress(rawSupportEmail, "AUTH_SUPPORT_EMAIL")
    : undefined;

  return {
    authEmailFrom,
    authRateLimitSecret,
    authSecret,
    authSupportEmail,
    authUrl,
    databaseUrl: required(env, "DATABASE_URL"),
    googleClientId: required(env, "GOOGLE_OAUTH_CLIENT_ID"),
    googleClientSecret: required(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
    resendApiKey,
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
