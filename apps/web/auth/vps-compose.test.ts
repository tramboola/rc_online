import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const composeUrl = new URL("../../../infra/compose/compose.vps-web.yaml", import.meta.url);
const envExampleUrl = new URL("../../../.env.example", import.meta.url);

describe("VPS authentication deployment", () => {
  test("keeps PostgreSQL private and waits for migrations before web starts", async () => {
    const compose = await readFile(composeUrl, "utf8");

    expect(compose).toMatch(/^  postgres:\s*$/mu);
    expect(compose).toMatch(/^  migrate:\s*$/mu);
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("rcmania-postgres-data:");
    expect(compose).toContain('"127.0.0.1:3000:3000"');
    expect(compose).toContain('"127.0.0.1:3002:3002"');
    expect(compose).toContain("GATEWAY_SESSION_SECRET:");

    const postgresService = compose.split(/^  migrate:\s*$/mu)[0] ?? "";
    expect(postgresService).not.toMatch(/^    ports:\s*$/mu);
  });

  test("keeps transactional email and abuse-prevention credentials server-only", async () => {
    const [compose, envExample] = await Promise.all([
      readFile(composeUrl, "utf8"),
      readFile(envExampleUrl, "utf8"),
    ]);

    for (const key of [
      "AUTH_RATE_LIMIT_SECRET",
      "RESEND_API_KEY",
      "AUTH_EMAIL_FROM",
      "AUTH_SUPPORT_EMAIL",
    ]) {
      expect(compose).toContain(`${key}:`);
      expect(envExample).toContain(`${key}=`);
    }
    expect(compose).not.toContain("NEXT_PUBLIC_RESEND");
    expect(envExample).not.toContain("NEXT_PUBLIC_RESEND");
    expect(envExample).toMatch(/^RESEND_API_KEY=\r?$/mu);
  });
});
