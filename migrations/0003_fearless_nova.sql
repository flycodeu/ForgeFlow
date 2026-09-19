CREATE TABLE `rd_feature` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`module_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `rd_module`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_feature_sort_order_non_negative" CHECK("rd_feature"."sort_order" >= 0),
	CONSTRAINT "rd_feature_status_allowed" CHECK("rd_feature"."status" in ('DRAFT', 'DESIGNING', 'READY', 'IMPLEMENTING', 'VERIFYING', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'DELIVERED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_feature_project_code_unique` ON `rd_feature` (`project_id`,`code`);--> statement-breakpoint
CREATE TABLE `rd_module` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_module_sort_order_non_negative" CHECK("rd_module"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_module_project_code_unique` ON `rd_module` (`project_id`,`code`);--> statement-breakpoint
ALTER TABLE `rd_spec` ADD `feature_id` text REFERENCES rd_feature(id);--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_feature_unique` ON `rd_spec` (`feature_id`);