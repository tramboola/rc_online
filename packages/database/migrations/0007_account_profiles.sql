ALTER TABLE "nicknames"
  ADD COLUMN "avatar_key" text;

UPDATE "nicknames"
SET "avatar_key" = 'racer-red'
WHERE "avatar_key" IS NULL;

ALTER TABLE "nicknames"
  ALTER COLUMN "avatar_key" SET NOT NULL,
  ALTER COLUMN "avatar_key" SET DEFAULT 'racer-red';

CREATE TABLE "password_credentials" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "password_hash" text NOT NULL,
  "password_changed_at" timestamptz NOT NULL DEFAULT now(),
  "verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "account_action_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('verify_email', 'reset_password')),
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "account_action_tokens_token_hash_unique"
  ON "account_action_tokens" ("token_hash");

CREATE INDEX "account_action_tokens_user_kind_idx"
  ON "account_action_tokens" ("user_id", "kind", "expires_at");

CREATE TABLE "auth_rate_limits" (
  "key_hash" text NOT NULL,
  "kind" text NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "attempt_count" integer NOT NULL CHECK ("attempt_count" > 0),
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("key_hash", "kind", "window_started_at")
);

CREATE INDEX "auth_rate_limits_expiry_idx"
  ON "auth_rate_limits" ("expires_at");

DO $account_profile_backfill$
DECLARE
  user_record record;
  base_nickname text;
  uuid_suffix text;
  candidate_nickname text;
  collision_attempt integer;
BEGIN
  FOR user_record IN
    SELECT u."id"
    FROM "users" u
    LEFT JOIN "nicknames" n ON n."user_id" = u."id"
    WHERE n."user_id" IS NULL AND u."disabled_at" IS NULL
    ORDER BY u."id"
  LOOP
    base_nickname := 'Driver-' || upper(substr(replace(user_record."id"::text, '-', ''), 1, 8));
    uuid_suffix := upper(substr(replace(user_record."id"::text, '-', ''), 9, 24));
    candidate_nickname := base_nickname;
    collision_attempt := 0;

    IF EXISTS (
      SELECT 1
      FROM "nicknames" n
      WHERE lower(n."nickname") = lower(candidate_nickname)
    ) THEN
      candidate_nickname := base_nickname || '-' || uuid_suffix;
    END IF;

    WHILE EXISTS (
      SELECT 1
      FROM "nicknames" n
      WHERE lower(n."nickname") = lower(candidate_nickname)
    ) LOOP
      collision_attempt := collision_attempt + 1;
      candidate_nickname := base_nickname || '-' || uuid_suffix || '-' || collision_attempt::text;
    END LOOP;

    INSERT INTO "nicknames" ("user_id", "nickname", "avatar_key")
    VALUES (user_record."id", candidate_nickname, 'racer-red');
  END LOOP;
END;
$account_profile_backfill$;

INSERT INTO "account_balances" ("user_id", "currency", "amount_minor")
SELECT u."id", 'USD', 0
FROM "users" u
LEFT JOIN "account_balances" b ON b."user_id" = u."id"
WHERE b."user_id" IS NULL AND u."disabled_at" IS NULL
ON CONFLICT ("user_id") DO NOTHING;
