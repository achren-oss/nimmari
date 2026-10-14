ALTER TABLE `field` ADD COLUMN `assigned_signer_key` text;
--> statement-breakpoint
ALTER TABLE `signing_session` ADD COLUMN `signer_key` text;
