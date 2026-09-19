CREATE TABLE `rd_task` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'OTHER' NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_task_sort_order_non_negative" CHECK("rd_task"."sort_order" >= 0),
	CONSTRAINT "rd_task_type_allowed" CHECK("rd_task"."type" in ('DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER')),
	CONSTRAINT "rd_task_status_allowed" CHECK("rd_task"."status" in ('PLANNED', 'AUTHORIZED', 'RUNNING', 'SUBMITTED', 'CONFIRMED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_task_feature_code_unique` ON `rd_task` (`feature_id`,`code`);