ALTER TABLE `document` ADD COLUMN `webhook_url` text;
--> statement-breakpoint
ALTER TABLE `document` ADD COLUMN `notify` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `field` ADD COLUMN `private_for_other_signers` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `field` ADD COLUMN `assigned_to_signer_email` text;
--> statement-breakpoint
ALTER TABLE `signing_session` ADD COLUMN `signer_order` integer;
--> statement-breakpoint
ALTER TABLE `signing_session` ADD COLUMN `invite_email_enabled` integer DEFAULT true NOT NULL;
