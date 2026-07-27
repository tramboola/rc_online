import { randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import Stripe from "stripe";

interface CheckoutInput {
  readonly userId: string;
  readonly priceId: string;
  readonly kind: "one_time" | "subscription";
  readonly idempotencyKey: string;
}

@Injectable()
export class BillingService {
  public async createCheckout(input: CheckoutInput) {
    if ((process.env.PAYMENT_PROVIDER ?? "mock") === "mock") {
      return {
        provider: "mock",
        providerSessionId: `cs_mock_${input.idempotencyKey}`,
        url: `/pricing?checkout=success&price=${encodeURIComponent(input.priceId)}`,
      };
    }

    const key = process.env.STRIPE_RESTRICTED_KEY;
    if (!key) {
      throw new Error("STRIPE_RESTRICTED_KEY is required for Stripe checkout");
    }
    const stripe = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });
    const suffix = randomBytes(4).toString("hex").slice(0, 8);
    const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
    const params = {
      mode: input.kind === "subscription" ? "subscription" : "payment",
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: `${appOrigin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appOrigin}/pricing?checkout=cancelled`,
      client_reference_id: input.userId,
      integration_identifier: `rc-racing-${suffix}`,
      metadata: {
        user_id: input.userId,
        idempotency_key: input.idempotencyKey,
      },
    } satisfies Stripe.Checkout.SessionCreateParams & {
      integration_identifier: string;
    };
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: input.idempotencyKey,
    });
    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }
    return {
      provider: "stripe",
      providerSessionId: session.id,
      url: session.url,
    };
  }
}
