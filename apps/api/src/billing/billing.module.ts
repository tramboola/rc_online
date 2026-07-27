import { Module } from "@nestjs/common";

import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { StripeWebhookController } from "./stripe-webhook.controller.js";
import { StripeWebhookService } from "./stripe-webhook.service.js";

@Module({
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, StripeWebhookService],
})
export class BillingModule {}
