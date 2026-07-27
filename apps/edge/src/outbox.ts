import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

export interface EdgeOutboxEvent {
  readonly id: string;
  readonly producer: string;
  readonly producerSequence: number;
  readonly topic: string;
  readonly payload: string;
  readonly idempotencyKey: string;
  readonly createdMonotonicNs: string;
  readonly status: "pending" | "acknowledged";
}

interface EdgeOutboxRow {
  readonly id: string;
  readonly producer: string;
  readonly producer_sequence: number;
  readonly topic: string;
  readonly payload: string;
  readonly idempotency_key: string;
  readonly created_monotonic_ns: string;
  readonly status: "pending" | "acknowledged";
}

function mapRow(row: EdgeOutboxRow): EdgeOutboxEvent {
  return {
    id: row.id,
    producer: row.producer,
    producerSequence: row.producer_sequence,
    topic: row.topic,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    createdMonotonicNs: row.created_monotonic_ns,
    status: row.status,
  };
}

export class EdgeOutbox {
  readonly #db: Database.Database;
  readonly #producer: string;

  public constructor(path: string, producer: string) {
    this.#producer = producer;
    this.#db = new Database(path);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = FULL");
    this.#db.pragma("busy_timeout = 5000");
    this.#db.exec(`
      create table if not exists edge_outbox (
        id text primary key,
        producer text not null,
        producer_sequence integer not null,
        topic text not null,
        payload text not null,
        idempotency_key text not null unique,
        created_monotonic_ns text not null,
        status text not null default 'pending',
        acknowledged_at text,
        unique (producer, producer_sequence)
      );
      create index if not exists edge_outbox_pending_idx
        on edge_outbox (status, producer_sequence);
    `);
  }

  public append(
    topic: string,
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): EdgeOutboxEvent {
    const existing = this.#db
      .prepare("select * from edge_outbox where idempotency_key = ?")
      .get(idempotencyKey) as EdgeOutboxRow | undefined;
    if (existing) {
      return mapRow(existing);
    }
    const next = this.#db
      .prepare(
        "select coalesce(max(producer_sequence), 0) + 1 as sequence from edge_outbox where producer = ?",
      )
      .get(this.#producer) as { sequence: number };
    const event: EdgeOutboxEvent = {
      id: randomUUID(),
      producer: this.#producer,
      producerSequence: next.sequence,
      topic,
      payload: JSON.stringify(payload),
      idempotencyKey,
      createdMonotonicNs: process.hrtime.bigint().toString(),
      status: "pending",
    };
    this.#db
      .prepare(
        `insert into edge_outbox (
          id, producer, producer_sequence, topic, payload,
          idempotency_key, created_monotonic_ns, status
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.producer,
        event.producerSequence,
        event.topic,
        event.payload,
        event.idempotencyKey,
        event.createdMonotonicNs,
        event.status,
      );
    return event;
  }

  public pending(limit = 100): readonly EdgeOutboxEvent[] {
    const rows = this.#db
      .prepare(
        "select * from edge_outbox where status = 'pending' order by producer_sequence limit ?",
      )
      .all(limit) as EdgeOutboxRow[];
    return rows.map(mapRow);
  }

  public acknowledge(eventId: string): void {
    this.#db
      .prepare(
        "update edge_outbox set status = 'acknowledged', acknowledged_at = ? where id = ?",
      )
      .run(new Date().toISOString(), eventId);
  }

  public close(): void {
    this.#db.close();
  }
}
