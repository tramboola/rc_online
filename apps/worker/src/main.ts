import "reflect-metadata";

import { createServer } from "node:http";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { parseRuntimeEnvironment } from "@rc/config";

import { WorkerModule } from "./worker.module.js";

const environment = parseRuntimeEnvironment();
const app = await NestFactory.createApplicationContext(WorkerModule, {
  logger: ["error", "warn", "log"],
});
app.enableShutdownHooks();
const healthServer = createServer((request, response) => {
  if (request.url === "/health/live" || request.url === "/health/ready") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "worker" }));
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((resolve, reject) => {
  healthServer.once("error", reject);
  healthServer.listen(environment.port, "0.0.0.0", resolve);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => healthServer.close());
}
Logger.log(
  {
    event: "worker.started",
    mode: environment.mode,
    mockMode: environment.mockMode,
    port: environment.port,
  },
  "Bootstrap",
);
