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

INSERT INTO "nicknames" ("user_id", "nickname", "avatar_key")
SELECT u."id", 'Driver-' || upper(substr(replace(u."id"::text, '-', ''), 1, 8)), 'racer-red'
FROM "users" u
LEFT JOIN "nicknames" n ON n."user_id" = u."id"
WHERE n."user_id" IS NULL AND u."disabled_at" IS NULL;

INSERT INTO "account_balances" ("user_id", "currency", "amount_minor")
SELECT u."id", 'USD', 0
FROM "users" u
LEFT JOIN "account_balances" b ON b."user_id" = u."id"
WHERE b."user_id" IS NULL AND u."disabled_at" IS NULL
ON CONFLICT ("user_id") DO NOTHING;
