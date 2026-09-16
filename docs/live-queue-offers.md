# Live queue acceptance window

An eligible driver has **15 seconds** to accept a currently available car. The
deadline is stored in `queue_entries.expires_at` while status is `offered`.
Polling, page reloads and repeated joins before expiry never extend it.

- `waiting`: renewable 60-second presence lease; no acceptance clock yet.
- `offered`: fixed 15-second deadline; the first N waiting users may select from
  the available fleet when N cars are free.
- `missed`: expired offer, removed from the active queue. GET/page reload does
  not rejoin. The user must explicitly select **REJOIN QUEUE** (POST).
- `accepted`: linked to a drive session; existing gateway session cleanup is
  unchanged.

Queue operations and session creation share a PostgreSQL transaction advisory
lock across web replicas. Reads and acceptance requests advance expired offers;
there is no background job requirement. Acceptance checks the deadline again
after lock waits. Loss of car availability cancels an offer without penalizing
the driver; recovery starts a new window.

The browser uses server-relative time, blocks accepting until its first fresh
GET, rejects stale responses and never extends a repeated offer's countdown.
The server remains authoritative if a tab is suspended or disconnected.

## Verification

Regular UI/unit tests: run `pnpm --filter @rc/web test`.

The PostgreSQL regression suite is opt-in through `QUEUE_TEST_DATABASE_URL`.
It only accepts localhost databases named `rcmania_queue_test_*`, initializes
repository migrations on an empty database, and **truncates its test data**.
Never point it at a database containing real data. It covers FIFO handoff,
expired acceptance, polling/rejoining, early session release, unavailable cars,
concurrent requests, multiple cars, and delayed lock acquisition.

No schema migration is required. These changes are local only; deployment is a
separate action requiring approval.
