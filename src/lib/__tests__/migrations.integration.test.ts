import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { getTableColumns, getTableName } from "drizzle-orm";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiKey, document, field, signingSession } from "@/db/schema";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("journaled OSS migrations", () => {
  for (const upgrade of [false, true]) {
    it(upgrade ? "upgrades v1.0.0 without losing records and is repeatable" : "creates a fresh database matching the current schema", async () => {
      const directory = mkdtempSync(join(tmpdir(), "puumerkki-migrations-"));
      directories.push(directory);
      const client = createClient({ url: `file:${join(directory, "test.db")}` });
      try {
        const db = drizzle(client);
        if (upgrade) {
          const oldFolder = join(directory, "old");
          mkdirSync(join(oldFolder, "meta"), { recursive: true });
          const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
          journal.entries = journal.entries.slice(0, 1);
          writeFileSync(join(oldFolder, "meta/_journal.json"), JSON.stringify(journal));
          writeFileSync(join(oldFolder, "0000_init.sql"), readFileSync("drizzle/0000_init.sql"));
          await migrate(db, { migrationsFolder: oldFolder });
          await client.execute("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@example.com', 1, 1)");
          await client.execute("INSERT INTO document (id, owner_id, title, status, created_at, updated_at) VALUES ('legacy', 'owner', 'Existing contract', 'sent', 1, 1)");
          await client.execute("INSERT INTO field (id, document_id, type, value) VALUES ('legacy-field', 'legacy', 'text', 'Preserved')");
          await client.execute("INSERT INTO signing_session (id, document_id, recipient_email, token, expires_at, created_at) VALUES ('legacy-session', 'legacy', 'signer@example.com', 'disposable-test-token', 2, 1)");
        }
        await migrate(db, { migrationsFolder: "drizzle" });
        await migrate(db, { migrationsFolder: "drizzle" });
        // Verify SQL idempotence too, rather than relying only on journal skipping.
        for (const statement of readFileSync("drizzle/0005_api_keys.sql", "utf8").split("--> statement-breakpoint")) {
          await client.execute(statement);
        }
        const indexes = await client.execute("PRAGMA index_list(api_key)");
        expect(indexes.rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: "api_key_key_hash_unique", unique: 1 }),
          expect.objectContaining({ name: "api_key_owner_idx" }),
        ]));
        for (const table of [apiKey, document, field, signingSession]) {
          const columns = await client.execute(`PRAGMA table_info(${getTableName(table)})`);
          expect(columns.rows.map((row) => row.name).sort()).toEqual(Object.values(getTableColumns(table)).map((column) => column.name).sort());
        }
        if (upgrade) {
          const row = (await client.execute("SELECT title, status, version, notify FROM document WHERE id = 'legacy'")).rows[0];
          expect(row).toMatchObject({ title: "Existing contract", status: "sent", version: 0, notify: 1 });
          expect((await client.execute("SELECT value FROM field WHERE id = 'legacy-field'")).rows[0].value).toBe("Preserved");
          expect((await client.execute("SELECT signer_key, invite_email_enabled FROM signing_session WHERE id = 'legacy-session'")).rows[0]).toMatchObject({ signer_key: null, invite_email_enabled: 1 });
        }
      } finally { client.close(); }
    });
  }
});
