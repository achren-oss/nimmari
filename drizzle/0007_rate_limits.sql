CREATE TABLE IF NOT EXISTS `rate_limit_bucket` (
  `key` text PRIMARY KEY NOT NULL,
  `window_start` integer NOT NULL,
  `count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rate_limit` (
  `id` text PRIMARY KEY NOT NULL,
  `key` text NOT NULL,
  `count` integer NOT NULL,
  `last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `rate_limit_key_unique` ON `rate_limit` (`key`);
