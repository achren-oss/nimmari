CREATE TABLE `send_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`document_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`response` text NOT NULL,
	`status_code` integer DEFAULT 200 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `document`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`url` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`last_status_code` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `document`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_due_idx` ON `webhook_delivery` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhook_owner_idx` ON `webhook_delivery` (`owner_id`,`created_at`);
