import { Body, Controller, Headers, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { BillingService } from "./billing.service.js";

@ApiTags("billing")
@Controller("/v1")
export class BillingController {
  public constructor(private readonly billing: BillingService) {}

  @Post("/checkout-sessions")
  public checkout(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body()
    body: {
      userId?: string;
      priceId: string;
      kind?: "one_time" | "subscription";
    },
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new Error("Idempotency-Key header is required");
    }
    return this.billing.createCheckout({
      userId: body.userId ?? "20000000-0000-4000-8000-000000000001",
      priceId: body.priceId,
      kind: body.kind ?? "one_time",
      idempotencyKey,
    });
  }
}
