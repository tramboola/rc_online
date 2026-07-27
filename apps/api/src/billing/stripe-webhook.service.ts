// Generated with: stripe-webhooks skill
// https://github.com/hookdeck/webhook-skills

import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import postgres from "postgres";
import Stripe from "stripe";

@Injectable()
export class StripeWebhookService {
  readonly #stripe: Stripe | null;
  readonly #sql;
  readonly #queue: Queue;

  public constructor() {
    const key = process.env.STRIPE_RESTRICTED_KEY;
    this.#stripe = key
      ? new Stripe(key, { apiVersion: "2026-06-24.dahlia" })
      : null;
    this.#sql = postgres(process.env.DATABASE_URL ?? "", {
      max: 2,
      prepare: false,
    });
    this.#queue = new Queue("stripe-events", {
      connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
  }

  public verify(rawBody: Buffer, signature: string): Stripe.Event {
    if ((process.env.PAYMENT_PROVIDER ?? "mock") === "mock") {
      const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("id" in parsed) ||
        !("type" in parsed)
      ) {
        throw new Error("Invalid mock Stripe event");
      }
      return parsed as Stripe.Event;
    }

    if (!this.#stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("Stripe webhook verification is not configured");
    }
    return this.#stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  }

  public async persistAndEnqueue(event: Stripe.Event): Promise<"accepted" | "duplicate"> {
    const inserted = await this.#sql<{ stripe_event_id: string }[]>`
      insert into stripe_events (
        stripe_event_id,
        event_type,
        livemode,
        api_version,
        payload,
        status
      )
      values (
        ${event.id},
        ${event.type},
        ${event.livemode},
        ${event.api_version ?? null},
        ${this.#sql.json(event as unknown as postgres.JSONValue)},
        'received'
      )
      on conflict (stripe_event_id) do nothing
      returning stripe_event_id
    `;
    if (inserted.length === 0) {
      return "duplicate";
    }
    await this.#queue.add(
      "process",
      { stripeEventId: event.id, eventType: event.type },
      { jobId: event.id },
    );
    return "accepted";
  }
}
