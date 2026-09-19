CREATE TABLE `rd_ai_run` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`task_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_name` text NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`phase` text DEFAULT 'PREPARING' NOT NULL,
	`base_commit` text,
	`result_commit` text,
	`summary` text DEFAULT '' NOT NULL,
	`changed_files` text DEFAULT '[]' NOT NULL,
	`verification_summary` text,
	`issues` text DEFAULT '[]' NOT NULL,
	`started_at` integer NOT NULL,
	`submitted_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_id`) REFERENCES `rd_task`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authorization_id`) REFERENCES `rd_task_authorization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_ai_run_actor_type_allowed" CHECK("rd_ai_run"."actor_type" in ('MANUAL', 'AI_TOKEN')),
	CONSTRAINT "rd_ai_run_status_allowed" CHECK("rd_ai_run"."status" in ('RUNNING', 'SUBMITTED', 'FAILED', 'ABORTED')),
	CONSTRAINT "rd_ai_run_phase_allowed" CHECK("rd_ai_run"."phase" in ('PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_ai_run_running_task_unique` ON `rd_ai_run` (`task_id`) WHERE "rd_ai_run"."status" = 'RUNNING';--> statement-breakpoint
CREATE TABLE `rd_task_authorization` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`authorized_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `rd_task`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_task_authorization_status_allowed" CHECK("rd_task_authorization"."status" in ('ACTIVE', 'REVOKED', 'CONSUMED')),
	CONSTRAINT "rd_task_authorization_revoked_time" CHECK(("rd_task_authorization"."status" = 'REVOKED' and "rd_task_authorization"."revoked_at" is not null) or ("rd_task_authorization"."status" != 'REVOKED' and "rd_task_authorization"."revoked_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_task_authorization_active_unique` ON `rd_task_authorization` (`task_id`) WHERE "rd_task_authorization"."status" = 'ACTIVE';