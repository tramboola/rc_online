import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const composeUrl = new URL("../../../infra/compose/compose.vps-web.yaml", import.meta.url);
const nginxUrl = new URL("../../../infra/nginx/rcmania.conf", import.meta.url);
const turnComposeUrl = new URL("../../../infra/compose/compose.turn.yaml", import.meta.url);
const turnConfigUrl = new URL("../../../infra/compose/coturn/turnserver.conf.template", import.meta.url);

describe("production gateway infrastructure", () => {
  it("runs a bounded localhost-only gateway with private database access", async () => {
    const compose = await readFile(composeUrl, "utf8");
    const gateway = compose.split(/^  gateway:\s*$/mu)[1] ?? "";

    expect(gateway).toContain('"127.0.0.1:3002:3002"');
    expect(gateway).toContain("/health/ready");
    expect(gateway).toContain("DEVICE_AUTH_PEPPER:");
    expect(gateway).toContain("GATEWAY_SESSION_SECRET:");
    expect(gateway).toContain('cpus: "0.30"');
    expect(gateway).toContain("mem_limit: 256m");
    expect(gateway).toMatch(/- edge\s+- state/u);
  });

  it("proxies same-origin WebSockets with a bounded idle timeout", async () => {
    const nginx = await readFile(nginxUrl, "utf8");
    const gateway = nginx.split("location /gateway/")[1] ?? "";

    expect(gateway).toContain("proxy_pass http://127.0.0.1:3002/");
    expect(gateway).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(gateway).toContain('proxy_set_header Connection "upgrade";');
    expect(gateway).toContain("proxy_read_timeout 360s;");
    expect(gateway).toContain("proxy_send_timeout 360s;");
  });

  it("keeps TURN opt-in with a bounded relay range and no browser password", async () => {
    const compose = await readFile(turnComposeUrl, "utf8");
    const config = await readFile(turnConfigUrl, "utf8");

    expect(compose).toContain('profiles: ["turn"]');
    expect(config).toContain("min-port=49160");
    expect(config).toContain("max-port=49200");
    expect(config).toContain("use-auth-secret");
    expect(config).not.toMatch(/credential=/u);
  });
});
