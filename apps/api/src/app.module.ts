import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { BillingModule } from "./billing/billing.module.js";
import { HealthController } from "./health.controller.js";
import { SimulationModule } from "./simulation/simulation.module.js";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.stripe-signature",
        ],
      },
    }),
    SimulationModule,
    BillingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
