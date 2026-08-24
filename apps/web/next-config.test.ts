import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("recovery response policy", () => {
  test("sets no-referrer after the site-wide policy for reset page and API responses", async () => {
    const configured = await nextConfig.headers?.();
    const recoveryRules = configured?.filter(({ source }) => (
      source === "/auth/reset-password" || source === "/api/account/reset-password"
    ));
    expect(recoveryRules).toEqual([
      {
        source: "/auth/reset-password",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/api/account/reset-password",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ]);
  });
});
