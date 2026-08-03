import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const composeUrl = new URL("../../../infra/compose/compose.vps-web.yaml", import.meta.url);

describe("VPS authentication deployment", () => {
  test("keeps PostgreSQL private and waits for migrations before web starts", async () => {
    const compose = await readFile(composeUrl, "utf8");

    expect(compose).toMatch(/^  postgres:\s*$/mu);
    expect(compose).toMatch(/^  migrate:\s*$/mu);
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("rcmania-postgres-data:");
    expect(compose).toContain('"127.0.0.1:3000:3000"');

    const postgresService = compose.split(/^  migrate:\s*$/mu)[0] ?? "";
    expect(postgresService).not.toMatch(/^    ports:\s*$/mu);
  });
});
