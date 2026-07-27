// Generated with: stripe-webhooks skill
// https://github.com/hookdeck/webhook-skills

import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { StripeWebhookService } from "./stripe-webhook.service.js";

@Controller("/v1/webhooks")
export class StripeWebhookController {
  public constructor(private readonly webhooks: StripeWebhookService) {}

  @Post("/stripe")
  @HttpCode(202)
  public async receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException("Raw request body is required");
    }
    if (
      (process.env.PAYMENT_PROVIDER ?? "mock") !== "mock" &&
      !signature
    ) {
      throw new BadRequestException("Stripe-Signature header is required");
    }
    const event = this.webhooks.verify(request.rawBody, signature ?? "mock");
    const status = await this.webhooks.persistAndEnqueue(event);
    return { status, eventId: event.id };
  }
}
