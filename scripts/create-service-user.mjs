// Create the account that owns documents submitted with the service account API key.
// Usage: node --env-file=.env.local scripts/create-service-user.mjs EMAIL "NAME"
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const email = process.argv[2] || process.env.SERVICE_USER_EMAIL;
const name = process.argv[3] || process.env.SERVICE_USER_NAME || "Service Account";
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name.trim() || process.argv.length > 4) {
  console.error('Usage: node scripts/create-service-user.mjs EMAIL "NAME" (or SERVICE_USER_EMAIL / SERVICE_USER_NAME)');
  process.exit(1);
}
const client = createClient({
  url: process.env.DATABASE_URL || "file:./local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});
try {
  const existing = await client.execute({ sql: "SELECT id FROM user WHERE email = ?", args: [email] });
  let id = existing.rows[0]?.id;
  if (!id) {
    id = "user_" + randomBytes(12).toString("base64url");
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, name.trim(), email, 1, now, now],
    });
    console.log("Created service user.");
  } else {
    console.log("Service user already exists.");
  }
  console.log(`NIMMARI_API_OWNER_ID=${id}`);
} finally {
  client.close();
}
