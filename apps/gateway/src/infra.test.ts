import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const composeUrl = new URL("../../../infra/compose/compose.vps-web.yaml", import.meta.url);
const nginxUrl = new URL("../../../infra/nginx/rcmania.conf", import.meta.url);
const turnComposeUrl = new URL("../../../infra/compose/compose.turn.yaml", import.meta.url);
const turnConfigUrl = new URL("../../../infra/compose/coturn/turnserver.conf.template", import.meta.url);
const turnEntrypointUrl = new URL("../../../infra/compose/coturn/entrypoint.sh", import.meta.url);
const turnFirewallUrl = new URL("../../../infra/turn/configure-firewall.sh", import.meta.url);

function extractNginxBlock(config: string, declaration: string): string {
  const marker = `${declaration} {`;
  const declarationStart = config.indexOf(marker);
  if (declarationStart < 0) throw new Error(`Missing Nginx block: ${declaration}`);

  const bodyStart = declarationStart + marker.length;
  let depth = 1;
  for (let index = bodyStart; index < config.length; index += 1) {
    if (config[index] === "{") depth += 1;
    if (config[index] === "}") depth -= 1;
    if (depth === 0) return config.slice(bodyStart, index);
  }

  throw new Error(`Unclosed Nginx block: ${declaration}`);
}

function proxyRequestPath(locationPrefix: string, proxyPassUri: string, requestPath: string): string {
  if (!requestPath.startsWith(locationPrefix)) {
    throw new Error(`${requestPath} is outside ${locationPrefix}`);
  }

  const schemeEnd = proxyPassUri.indexOf("://");
  const upstreamUriStart = proxyPassUri.indexOf("/", schemeEnd + 3);
  if (upstreamUriStart < 0) return requestPath;

  const upstreamUri = new URL(proxyPassUri).pathname;
  return `${upstreamUri}${requestPath.slice(locationPrefix.length)}`;
}

describe("production gateway infrastructure", () => {
  it("runs a bounded localhost-only gateway with private database access", async () => {
    const compose = await readFile(composeUrl, "utf8");
    const gateway = compose.split(/^  gateway:\s*$/mu)[1] ?? "";

    expect(gateway).toContain('"127.0.0.1:3002:3002"');
    expect(gateway).toContain("/health/ready");
    expect(gateway).toContain("DEVICE_AUTH_PEPPER:");
    expect(gateway).toContain("GATEWAY_SESSION_SECRET:");
    expect(gateway).toContain("GATEWAY_VIEWER_CAPACITY: ${GATEWAY_VIEWER_CAPACITY:-500}");
    expect(gateway).toMatch(/group_add:\s+- "33"/u);
    expect(gateway).toContain('cpus: "0.30"');
    expect(gateway).toContain("mem_limit: 256m");
    expect(gateway).toMatch(/- edge\s+- state/u);
  });

  it("routes authenticated sockets and health checks through the generic gateway proxy", async () => {
    const nginx = await readFile(nginxUrl, "utf8");
    const gateway = extractNginxBlock(nginx, "location /gateway/");
    const web = extractNginxBlock(nginx, "location /");
    const routes = [
      ["/gateway/v1/socket", "/v1/socket"],
      ["/gateway/health/live", "/health/live"],
      ["/gateway/health/ready", "/health/ready"],
    ] as const;
    const proxyPassUri = gateway.match(/^\s*proxy_pass\s+(\S+);\s*$/mu)?.[1];

    expect(gateway).toContain("proxy_http_version 1.1;");
    expect(gateway).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(gateway).toContain('proxy_set_header Connection "upgrade";');
    expect(gateway).toContain("proxy_read_timeout 360s;");
    expect(gateway).toContain("proxy_send_timeout 360s;");
    expect(proxyPassUri).toBeDefined();
    expect(new URL(proxyPassUri!).origin).toBe("http://127.0.0.1:3002");

    for (const [requestPath, upstreamPath] of routes) {
      expect(proxyRequestPath("/gateway/", proxyPassUri!, requestPath)).toBe(upstreamPath);
    }

    expect(web).toContain("proxy_pass http://127.0.0.1:3000;");
  });

  it("isolates the exact viewer proxy from identifying headers and access logs", async () => {
    const nginx = await readFile(nginxUrl, "utf8");
    const viewerDeclaration = "location = /gateway/v1/viewers";
    const viewer = extractNginxBlock(nginx, viewerDeclaration);
    const genericGatewayIndex = nginx.indexOf("location /gateway/");
    const viewerIndex = nginx.indexOf(`${viewerDeclaration} {`);
    const proxyPassUri = viewer.match(/^\s*proxy_pass\s+(\S+);\s*$/mu)?.[1];

    expect(viewerIndex).toBeGreaterThanOrEqual(0);
    expect(viewerIndex).toBeLessThan(genericGatewayIndex);
    expect(proxyPassUri).toBe("http://127.0.0.1:3002/v1/viewers");
    expect(proxyRequestPath("/gateway/v1/viewers", proxyPassUri!, "/gateway/v1/viewers")).toBe("/v1/viewers");
    expect(viewer).toContain("access_log off;");
    expect(viewer).toContain("error_log /dev/null crit;");
    expect(viewer).toContain('proxy_set_header Cookie "";');
    expect(viewer).toContain('proxy_set_header Authorization "";');
    expect(viewer).toContain('proxy_set_header X-Real-IP "";');
    expect(viewer).toContain('proxy_set_header X-Forwarded-For "";');
    expect(viewer).toContain('proxy_set_header User-Agent "";');
    expect(viewer).toContain("proxy_http_version 1.1;");
    expect(viewer).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(viewer).toContain('proxy_set_header Connection "upgrade";');
    expect(viewer).toContain("proxy_read_timeout 360s;");
    expect(viewer).toContain("proxy_send_timeout 360s;");
  });

  it("bounds viewer connections and handshakes globally without an IP-derived key", async () => {
    const nginx = await readFile(nginxUrl, "utf8");
    const viewer = extractNginxBlock(nginx, "location = /gateway/v1/viewers");
    const serverStart = nginx.indexOf("server {");
    const httpContext = nginx.slice(0, serverStart);
    const connectionZone = httpContext.match(/^\s*limit_conn_zone\s+(\S+)\s+zone=(\w+):(\S+);\s*$/mu);
    const handshakeZone = httpContext.match(/^\s*limit_req_zone\s+(\S+)\s+zone=(\w+):(\S+)\s+rate=(\S+);\s*$/mu);

    expect(connectionZone?.slice(1)).toEqual(["$server_name", "viewer_connections", "64k"]);
    expect(handshakeZone?.slice(1)).toEqual(["$server_name", "viewer_handshakes", "64k", "20r/s"]);
    expect(httpContext).not.toMatch(/\$(?:binary_)?remote_addr/u);
    expect(viewer).toContain("limit_conn viewer_connections 500;");
    expect(viewer).toContain("limit_conn_status 503;");
    expect(viewer).toContain("limit_req zone=viewer_handshakes burst=100 nodelay;");
    expect(viewer).toContain("limit_req_status 503;");
  });

  it("serves immutable signed agent releases without directory listing", async () => {
    const nginx = await readFile(nginxUrl, "utf8");
    expect(nginx).toContain("location /agent-releases/");
    expect(nginx).toContain("alias /opt/rcmania/shared/agent-releases/");
    expect(nginx).toContain('add_header Cache-Control "public, max-age=31536000, immutable"');
    expect(nginx).toContain("autoindex off");
  });

  it("runs isolated pinned Coturn with TLS, bounded resources, and file-mounted secrets", async () => {
    const compose = await readFile(turnComposeUrl, "utf8");
    const config = await readFile(turnConfigUrl, "utf8");
    const entrypoint = await readFile(turnEntrypointUrl, "utf8");

    expect(compose).toContain("coturn/coturn:4.16.0-r0-alpine");
    expect(compose).toContain("network_mode: host");
    expect(compose).toContain('user: "0:0"');
    expect(compose).toContain("cap_add: [NET_BIND_SERVICE, SETGID, SETUID]");
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
    expect(config).toContain("proc-user=nobody");
    expect(config).toContain("proc-group=nogroup");
    expect(config).not.toContain("no-loopback-peers");
    expect(config).not.toContain("no-tlsv1");
    expect(config).not.toContain("no-cli");
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
