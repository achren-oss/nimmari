// Applies SQL migrations from ./drizzle to DATABASE_URL (file: or libsql://).
// Run automatically by the Docker image before the server starts.
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL ?? "file:./local.db";
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

const client = createClient({ url, authToken });
await migrate(drizzle(client), { migrationsFolder });
client.close();
console.log("Database migrations applied.");
