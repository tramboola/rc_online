import { loadGatewayConfig } from "./config.js";
import { PostgresGatewayStore } from "./postgres-store.js";
import { createGatewayServer } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const config = loadGatewayConfig();
const store = new PostgresGatewayStore(databaseUrl);
const server = createGatewayServer(config, store);

const shutdown = async () => {
  await server.close();
  await store.close();
};
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

await server.listen({ host: config.host, port: config.port });
