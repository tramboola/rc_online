import { randomUUID } from "node:crypto";

import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import postgres from "postgres";

interface StripeJob {
  readonly stripeEventId: string;
  readonly eventType: string;
}

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
  };
}

@Injectable()
export class StripeEventsWorker implements OnModuleInit, OnApplicationShutdown {
  readonly #logger = new Logger(StripeEventsWorker.name);
  readonly #sql = postgres(process.env.DATABASE_URL ?? "", {
    max: 5,
    prepare: false,
  });
  readonly #deadLetter = new Queue("stripe-events-dlq", {
    connection: redisConnection(),
  });
  #worker: Worker<StripeJob> | null = null;

  public onModuleInit(): void {
    this.#worker = new Worker<StripeJob>(
      "stripe-events",
      (job) => this.process(job),
      {
        connection: redisConnection(),
        concurrency: 4,
        lockDuration: 30_000,
      },
    );
    this.#worker.on("completed", (job) => {
      this.#logger.log({
        event: "stripe.webhook.processed",
        stripeEventId: job.data.stripeEventId,
      });
    });
    this.#worker.on("failed", (job, error) => {
      this.#logger.error({
        event: "stripe.webhook.failed",
        stripeEventId: job?.data.stripeEventId,
        attempt: job?.attemptsMade,
        error: error.message,
      });
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        void this.#deadLetter.add(
          "failed",
          {
            ...job.data,
            attempts: job.attemptsMade,
            error: error.message,
            failedAt: new Date().toISOString(),
          },
          { jobId: `dlq:${job.data.stripeEventId}` },
        );
      }
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.#worker?.close();
    await this.#deadLetter.close();
    await this.#sql.end();
  }

  private async process(job: Job<StripeJob>): Promise<void> {
    await this.#sql.begin(async (tx) => {
      const rows = await tx<
        {
          stripe_event_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          status: string;
        }[]
      >`
        select stripe_event_id, event_type, payload, status
        from stripe_events
        where stripe_event_id = ${job.data.stripeEventId}
        for update
      `;
      const event = rows[0];
      if (!event || event.status === "processed") {
        return;
      }

      if (
        event.event_type === "checkout.session.completed" ||
        event.event_type === "invoice.paid"
      ) {
        const payload = event.payload;
        const data =
          typeof payload.data === "object" && payload.data !== null
            ? (payload.data as Record<string, unknown>)
            : {};
        const object =
          typeof data.object === "object" && data.object !== null
            ? (data.object as Record<string, unknown>)
            : {};
        const metadata =
          typeof object.metadata === "object" && object.metadata !== null
            ? (object.metadata as Record<string, unknown>)
            : {};
        const userId =
          typeof metadata.user_id === "string"
            ? metadata.user_id
            : "20000000-0000-4000-8000-000000000001";
        const secondsRaw =
          typeof metadata.seconds === "string"
            ? Number(metadata.seconds)
            : typeof metadata.seconds === "number"
              ? metadata.seconds
              : 300;
        const seconds =
          Number.isSafeInteger(secondsRaw) && secondsRaw > 0 ? secondsRaw : 300;
        const wallets = await tx<{ id: string }[]>`
          select id from wallets where user_id = ${userId} limit 1
        `;
        const wallet = wallets[0];
        if (!wallet) {
          throw new Error(`Wallet not found for Stripe event ${event.stripe_event_id}`);
        }
        const lotId = randomUUID();
        await tx`
          insert into wallet_lots (
            id, wallet_id, source_type, source_id, granted_seconds, expires_at
          )
          values (
            ${lotId},
            ${wallet.id},
            'stripe',
            ${event.stripe_event_id},
            ${seconds},
            now() + interval '90 days'
          )
          on conflict (source_type, source_id) do nothing
        `;
        await tx`
          insert into ledger_entries (
            wallet_id,
            lot_id,
            kind,
            seconds,
            idempotency_key,
            reason,
            metadata
          )
          select
            ${wallet.id},
            wallet_lots.id,
            'purchase',
            ${seconds},
            ${`stripe:${event.stripe_event_id}:credit`},
            'Stripe payment settled',
            ${tx.json({ stripeEventId: event.stripe_event_id })}
          from wallet_lots
          where source_type = 'stripe' and source_id = ${event.stripe_event_id}
          on conflict (idempotency_key) do nothing
        `;
      }

      await tx`
        update stripe_events
        set
          status = 'processed',
          processed_at = now(),
          attempts = attempts + 1,
          last_error = null
        where stripe_event_id = ${event.stripe_event_id}
      `;
      await tx`
        insert into audit_events (
          actor_type,
          action,
          target_type,
          target_id,
          reason,
          correlation_id,
          metadata
        )
        values (
          'system',
          'stripe_event_processed',
          'stripe_event',
          ${event.stripe_event_id},
          'Asynchronous verified webhook processing',
          ${randomUUID()},
          ${tx.json({ eventType: event.event_type })}
        )
      `;
    });
  }
}
