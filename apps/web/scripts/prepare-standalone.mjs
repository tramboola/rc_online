import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneApp = resolve(
  appRoot,
  ".next/standalone/apps/web",
);

await mkdir(resolve(standaloneApp, ".next"), { recursive: true });
await cp(resolve(appRoot, "public"), resolve(standaloneApp, "public"), {
  recursive: true,
  force: true,
});
await cp(
  resolve(appRoot, ".next/static"),
  resolve(standaloneApp, ".next/static"),
  {
    recursive: true,
    force: true,
  },
);
