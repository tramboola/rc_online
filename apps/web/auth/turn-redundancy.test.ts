import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createPublicIceServers, readIceTransportPolicy } from "../app/drive-session-ticket";

it("advertises both TURN hosts to web and gateway with temporary credentials and direct ICE enabled", async () => {
  const compose = await readFile(new URL("../../../infra/compose/compose.vps-web.yaml", import.meta.url), "utf8");
  const defaults = [...compose.matchAll(/GATEWAY_ICE_SERVERS_JSON: \$\{GATEWAY_ICE_SERVERS_JSON:-([^\n]+)\}/g)].map((match) => match[1]!);
  expect(defaults).toHaveLength(2);
  expect(defaults[0]).toBe(defaults[1]);
  for (const value of defaults) {
    const servers = createPublicIceServers("test-ride", new Date("2030-01-01T12:00:00Z"), {
      GATEWAY_ICE_SERVERS_JSON: value, TURN_SHARED_SECRET_FILE: "test-secret", TURN_CREDENTIAL_TTL_SECONDS: "600",
    }, () => "turn-shared-secret-only-for-tests-123456789");
    for (const host of ["turn.rcmania.live", "turn2.rcmania.live"]) {
      expect(servers).toContainEqual({ urls: `stun:${host}:3478` });
      for (const url of [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`, `turns:${host}:443?transport=tcp`]) {
        expect(servers).toContainEqual({ urls: url, username: "1893499800:test-ride", credential: expect.any(String) });
      }
    }
  }
  expect(readIceTransportPolicy({})).toBe("all");
});
