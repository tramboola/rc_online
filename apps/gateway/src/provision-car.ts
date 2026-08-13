import { generateOpaqueSecret, hashOpaqueSecret } from "@rc/device-auth";

import { loadGatewayConfig } from "./config.js";
import { PostgresGatewayStore } from "./postgres-store.js";

export async function provisionCar(argv = process.argv.slice(2), env = process.env): Promise<string> {
  const slug = readArgument(argv, "--slug");
  const name = readArgument(argv, "--name");
  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");
  const config = loadGatewayConfig(env);
  const store = new PostgresGatewayStore(databaseUrl);
  const code = `enr_${generateOpaqueSecret()}`;
  const now = new Date();
  try {
    await store.provisionCar({
      siteSlug: env.RC_SITE_SLUG ?? "rcmania-primary",
      siteName: env.RC_SITE_NAME ?? "RC Mania Primary",
      timezone: env.RC_SITE_TIMEZONE ?? "Europe/Prague",
      carSlug: slug,
      carName: name,
      tokenHash: hashOpaqueSecret(code, config.deviceAuthPepper),
      expiresAt: new Date(now.getTime() + 30 * 60_000),
      now
    });
    return code;
  } finally {
    await store.close();
  }
}

function readArgument(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  provisionCar()
    .then((code) => process.stdout.write(`${code}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Provisioning failed"}\n`);
      process.exitCode = 1;
    });
}
