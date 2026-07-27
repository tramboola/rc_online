import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, "../migrations");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

await sql`
  create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )
`;

const files = (await readdir(migrationDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  const applied = await sql<{ version: string }[]>`
    select version from schema_migrations where version = ${file}
  `;
  if (applied.length > 0) {
    continue;
  }
  const body = await readFile(path.join(migrationDir, file), "utf8");
  await sql.begin(async (transaction) => {
    await transaction.unsafe(body);
    await transaction`
      insert into schema_migrations (version) values (${file})
    `;
  });
  process.stdout.write(`Applied ${file}\n`);
}

await sql.end();
