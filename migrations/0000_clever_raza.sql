CREATE TABLE `rd_project` (
	`id` text PRIMARY KEY NOT NULL,
	`project_key` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_project_project_key_unique` ON `rd_project` (`project_key`);--> statement-breakpoint
CREATE TABLE `rd_spec_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`spec_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`markdown` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`spec_id`) REFERENCES `rd_spec`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_spec_revision_no_positive" CHECK("rd_spec_revision"."revision_no" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_revision_spec_no_unique` ON `rd_spec_revision` (`spec_id`,`revision_no`);--> statement-breakpoint
CREATE TABLE `rd_spec` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict
);
