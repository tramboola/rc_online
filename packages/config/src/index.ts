export type RuntimeMode = "development" | "test" | "production";

export type IdentityProviderName = "mock" | "google";
export type PaymentProviderName = "mock" | "stripe";
export type DeviceProviderName = "simulator" | "physical";
export type TimingProviderName = "simulator" | "openstint" | "trackmate";
export type CameraProviderName = "loop" | "rtsp";
export type PublicStreamProviderName = "mediamtx" | "youtube";

export interface RuntimeEnvironment {
  readonly mode: RuntimeMode;
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly mockMode: boolean;
  readonly identityProvider: IdentityProviderName;
  readonly paymentProvider: PaymentProviderName;
  readonly deviceProvider: DeviceProviderName;
  readonly timingProvider: TimingProviderName;
  readonly cameraProvider: CameraProviderName;
  readonly publicStreamProvider: PublicStreamProviderName;
  readonly simulationScenario: string;
}

const trueValues = new Set(["1", "true", "yes", "on"]);
const productionForbiddenValues = new Set([
  "mock",
  "sim",
  "simulator",
  "loop",
  "mailpit",
  "mediamtx",
]);

function asMode(value: string | undefined): RuntimeMode {
  if (value === "production" || value === "test") {
    return value;
  }
  return "development";
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function asPort(value: string | undefined): number {
  const parsed = Number(value ?? "3001");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function asBoolean(value: string | undefined): boolean {
  return value ? trueValues.has(value.toLowerCase()) : false;
}

export function assertNoProductionMocks(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const forbidden = Object.entries(env)
    .filter(([key, value]) => {
      if (!value?.trim()) {
        return false;
      }
      const normalized = value.trim().toLowerCase();
      return (
        (key.startsWith("MOCK_") && asBoolean(value)) ||
        key === "SIMULATION_SCENARIO" ||
        (key.endsWith("_PROVIDER") && productionForbiddenValues.has(normalized))
      );
    })
    .map(([key]) => key);

  if (forbidden.length > 0) {
    throw new Error(
      `Production startup refused: simulation configuration present (${forbidden.sort().join(", ")})`,
    );
  }
}

export function parseRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironment {
  const mode = asMode(env.NODE_ENV);
  const identityProvider = env.IDENTITY_PROVIDER ?? "mock";
  const paymentProvider = env.PAYMENT_PROVIDER ?? "mock";
  const deviceProvider = env.DEVICE_PROVIDER ?? "simulator";
  const timingProvider = env.TIMING_PROVIDER ?? "simulator";
  const cameraProvider = env.CAMERA_PROVIDER ?? "loop";
  const publicStreamProvider = env.PUBLIC_STREAM_PROVIDER ?? "mediamtx";
  assertNoProductionMocks({
    ...env,
    IDENTITY_PROVIDER: identityProvider,
    PAYMENT_PROVIDER: paymentProvider,
    DEVICE_PROVIDER: deviceProvider,
    TIMING_PROVIDER: timingProvider,
    CAMERA_PROVIDER: cameraProvider,
    PUBLIC_STREAM_PROVIDER: publicStreamProvider,
  });

  return {
    mode,
    port: asPort(env.PORT),
    databaseUrl: required(env, "DATABASE_URL"),
    redisUrl: required(env, "REDIS_URL"),
    mockMode: asBoolean(env.MOCK_MODE),
    identityProvider: identityProvider as IdentityProviderName,
    paymentProvider: paymentProvider as PaymentProviderName,
    deviceProvider: deviceProvider as DeviceProviderName,
    timingProvider: timingProvider as TimingProviderName,
    cameraProvider: cameraProvider as CameraProviderName,
    publicStreamProvider: publicStreamProvider as PublicStreamProviderName,
    simulationScenario: env.SIMULATION_SCENARIO ?? "normal",
  };
}
