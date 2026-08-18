import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const composeUrl = new URL("../../../infra/compose/compose.vps-web.yaml", import.meta.url);
const nginxUrl = new URL("../../../infra/nginx/rcmania.conf", import.meta.url);
const turnComposeUrl = new URL("../../../infra/compose/compose.turn.yaml", import.meta.url);
const turnConfigUrl = new URL("../../../infra/compose/coturn/turnserver.conf.template", import.meta.url);
const turnEntrypointUrl = new URL("../../../infra/compose/coturn/entrypoint.sh", import.meta.url);
const turnFirewallUrl = new URL("../../../infra/turn/configure-firewall.sh", import.meta.url);

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

  it("runs isolated pinned Coturn with TLS, bounded resources, and file-mounted secrets", async () => {
    const compose = await readFile(turnComposeUrl, "utf8");
    const config = await readFile(turnConfigUrl, "utf8");
    const entrypoint = await readFile(turnEntrypointUrl, "utf8");

    expect(compose).toContain("coturn/coturn:4.16.0-r0-alpine");
    expect(compose).toContain("network_mode: host");
    expect(compose).toContain("turn_shared_secret");
    expect(compose).toContain("/etc/letsencrypt:/etc/letsencrypt:ro");
    expect(compose).toContain('cpus: "0.80"');
    expect(compose).toContain("mem_limit: 384m");
    expect(compose).toContain("turnutils_stunclient");
    expect(config).toContain("min-port=49160");
    expect(config).toContain("max-port=49259");
    expect(config).toContain("tls-listening-port=443");
    expect(config).toContain("cert=/etc/letsencrypt/live/turn.rcmania.live/fullchain.pem");
    expect(config).toContain("use-auth-secret");
    expect(config).not.toContain("static-auth-secret=");
    expect(entrypoint).toContain("/run/secrets/turn_shared_secret");
    expect(entrypoint).toContain("static-auth-secret=");
    expect(config).not.toMatch(/credential=/u);
  });

  it("mounts the TURN secret into web and gateway without exposing it as an environment value", async () => {
    const compose = await readFile(composeUrl, "utf8");
    expect(compose.match(/TURN_SHARED_SECRET_FILE:/gu)).toHaveLength(2);
    expect(compose.match(/- turn_shared_secret/gu)).toHaveLength(2);
    expect(compose).not.toContain("TURN_SHARED_SECRET: ${");
    expect(compose).toContain("turn:turn.rcmania.live:3478?transport=udp");
    expect(compose).toContain("turns:turn.rcmania.live:443?transport=tcp");
  });

  it("allows SSH and OpenVPN before enabling the TURN host firewall", async () => {
    const firewall = await readFile(turnFirewallUrl, "utf8");
    const enableIndex = firewall.indexOf("ufw --force enable");
    expect(enableIndex).toBeGreaterThan(0);
    expect(firewall.indexOf("22/tcp")).toBeLessThan(enableIndex);
    expect(firewall.indexOf("1194/udp")).toBeLessThan(enableIndex);
    expect(firewall).toContain("49160:49259/udp");
    expect(firewall).not.toContain("docker system prune");
    expect(firewall).not.toContain("docker compose down");
    expect(firewall).not.toContain("systemctl restart docker");
  });
});
