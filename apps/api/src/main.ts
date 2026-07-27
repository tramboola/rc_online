import "reflect-metadata";

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { parseRuntimeEnvironment } from "@rc/config";

import { AppModule } from "./app.module.js";

const environment = parseRuntimeEnvironment();
const adapter = new FastifyAdapter({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.stripe-signature",
    ],
  },
  genReqId: (request: IncomingMessage) => {
    const existing = request.headers["x-correlation-id"];
    return typeof existing === "string" ? existing : randomUUID();
  },
  trustProxy: true,
  bodyLimit: 1_048_576,
});

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  adapter,
  { rawBody: true },
);

app.enableCors({
  origin: process.env.APP_ORIGIN ?? "http://localhost:3000",
  credentials: true,
});
app.enableShutdownHooks();

const openApiConfig = new DocumentBuilder()
  .setTitle("RC Racing API")
  .setDescription("Versioned RC Racing simulation and production contracts")
  .setVersion("1.0.0")
  .addCookieAuth("rc_session")
  .build();
const document = SwaggerModule.createDocument(app, openApiConfig);
for (const path of ["/openapi", "/openapi.json"] as const) {
  adapter
    .getInstance()
    .get(path, async (_request, reply) => reply.send(document));
}

await app.listen(environment.port, "0.0.0.0");
Logger.log(
  {
    event: "api.started",
    port: environment.port,
    mode: environment.mode,
    mockMode: environment.mockMode,
  },
  "Bootstrap",
);
