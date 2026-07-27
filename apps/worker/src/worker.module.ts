import { Module } from "@nestjs/common";

import { StripeEventsWorker } from "./stripe-events.worker.js";

@Module({
  providers: [StripeEventsWorker],
})
export class WorkerModule {}
