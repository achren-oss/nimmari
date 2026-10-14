CREATE TABLE IF NOT EXISTS `api_key` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `owner_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `scope` text DEFAULT 'regular' NOT NULL CHECK (`scope` IN ('admin', 'regular')),
  `key_hash` text NOT NULL,
  `key_prefix` text NOT NULL,
  `created_at` integer NOT NULL,
  `last_used_at` integer,
  `revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `api_key_key_hash_unique` ON `api_key` (`key_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `api_key_owner_idx` ON `api_key` (`owner_user_id`);
