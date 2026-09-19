CREATE TABLE `rd_ai_token` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `rd_owner`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_ai_token_token_hash_unique` ON `rd_ai_token` (`token_hash`);--> statement-breakpoint
CREATE TABLE `rd_owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "rd_owner_singleton" CHECK("rd_owner"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_owner_username_unique` ON `rd_owner` (`username`);--> statement-breakpoint
CREATE TABLE `rd_owner_session` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`owner_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `rd_owner`(`id`) ON UPDATE no action ON DELETE restrict
);
