-- Core project, specification, and authentication schema.

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



-- Immutable specification revision metadata.

ALTER TABLE `rd_spec_revision` ADD `source` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `rd_spec_revision` ADD `change_summary` text DEFAULT '未记录（旧版）' NOT NULL;--> statement-breakpoint
ALTER TABLE `rd_spec` ADD `latest_revision_id` text REFERENCES rd_spec_revision(id);--> statement-breakpoint
UPDATE `rd_spec` SET `latest_revision_id` = (
  SELECT `id` FROM `rd_spec_revision`
  WHERE `spec_id` = `rd_spec`.`id`
  ORDER BY `revision_no` DESC LIMIT 1
) WHERE `latest_revision_id` IS NULL;--> statement-breakpoint
CREATE TRIGGER `rd_spec_revision_no_update`
BEFORE UPDATE ON `rd_spec_revision`
BEGIN
  SELECT RAISE(ABORT, 'Specification revisions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `rd_spec_revision_no_delete`
BEFORE DELETE ON `rd_spec_revision`
BEGIN
  SELECT RAISE(ABORT, 'Specification revisions are immutable');
END;



-- Specification head revision link.

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



-- Module and feature structure.

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


-- Implementation task structure.

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


-- Authorization and AI execution records.

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
