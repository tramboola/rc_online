import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createDatabase, firmwareVersions } from "@rc/database";
import { z } from "zod";

const releaseSchema = z.object({
  artifactSizeBytes: z.number().int().min(1).max(8 * 1024 * 1024),
  artifactUrl: z.string().url(),
  channel: z.literal("stable"),
  componentKind: z.literal("pi-agent"),
  digestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  runtimeGeneration: z.number().int().min(1).max(32767),
  signature: z.string().regex(/^[A-Za-z0-9_-]{80,128}$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
}).strict().superRefine((value, context) => {
  const expected = `https://rcmania.live/agent-releases/rc-pi-agent-${value.version}.pyz`;
  if (value.artifactUrl !== expected) {
    context.addIssue({ code: "custom", path: ["artifactUrl"], message: `artifactUrl must be ${expected}` });
  }
});

export type AgentReleaseManifest = z.infer<typeof releaseSchema>;

export function parseAgentReleaseManifest(value: unknown): AgentReleaseManifest {
  return releaseSchema.parse(value);
}

export async function registerAgentRelease(manifestPath: string, databaseUrl: string): Promise<string> {
  const manifest = parseAgentReleaseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const database = createDatabase(databaseUrl);
  try {
    const [created] = await database.db.insert(firmwareVersions).values({
      componentKind: manifest.componentKind,
      version: manifest.version,
      digestSha256: manifest.digestSha256,
      signature: manifest.signature,
      channel: manifest.channel,
      artifactUrl: manifest.artifactUrl,
      artifactSizeBytes: manifest.artifactSizeBytes,
      runtimeGeneration: manifest.runtimeGeneration,
      publishedAt: new Date(),
    }).returning({ id: firmwareVersions.id });
    if (!created) throw new Error("Release was not registered");
    return created.id;
  } finally {
    await database.client.end();
  }
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!manifestPath || !databaseUrl) throw new Error("Usage: register-agent-release <manifest.json>; DATABASE_URL is required");
  const id = await registerAgentRelease(manifestPath, databaseUrl);
  process.stdout.write(`${id}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Release registration failed"}\n`);
    process.exitCode = 1;
  });
}
