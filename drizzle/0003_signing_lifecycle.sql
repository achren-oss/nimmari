ALTER TABLE `document` ADD COLUMN `version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `document` ADD COLUMN `cancelled_at` integer;
--> statement-breakpoint
ALTER TABLE `document` ADD COLUMN `cancel_reason` text;
--> statement-breakpoint
ALTER TABLE `document` ADD COLUMN `declined_at` integer;
--> statement-breakpoint
ALTER TABLE `document` ADD COLUMN `decline_reason` text;
--> statement-breakpoint
ALTER TABLE `signing_session` ADD COLUMN `declined_at` integer;
--> statement-breakpoint
ALTER TABLE `signing_session` ADD COLUMN `decline_reason` text;
