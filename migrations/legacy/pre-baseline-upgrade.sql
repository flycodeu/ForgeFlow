-- forgeflow-legacy-step:1789795201344

ALTER TABLE `rd_project` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_project_kind_unique` ON `rd_spec` (`project_id`,`kind`) WHERE "rd_spec"."feature_id" is null;


-- forgeflow-legacy-step:1789797001647

CREATE TABLE `rd_design_review` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`spec_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`submitted_at` integer NOT NULL,
	`decided_at` integer,
	`decision_comment` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`spec_id`) REFERENCES `rd_spec`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_design_review_status_allowed" CHECK("rd_design_review"."status" in ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED')),
	CONSTRAINT "rd_design_review_decision_time" CHECK(("rd_design_review"."status" = 'PENDING' and "rd_design_review"."decided_at" is null) or ("rd_design_review"."status" != 'PENDING' and "rd_design_review"."decided_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_design_review_revision_pending_unique` ON `rd_design_review` (`revision_id`) WHERE "rd_design_review"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX `rd_design_review_spec_pending_unique` ON `rd_design_review` (`spec_id`) WHERE "rd_design_review"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE `rd_spec` ADD `approved_revision_id` text REFERENCES rd_spec_revision(id);--> statement-breakpoint
ALTER TABLE `rd_task` ADD `design_revision_id` text REFERENCES rd_spec_revision(id);


-- forgeflow-legacy-step:1789799485621

ALTER TABLE `rd_project` ADD `project_type` text DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `rd_task` ADD `category` text DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE `rd_task` ADD `area` text DEFAULT '' NOT NULL;


-- forgeflow-legacy-step:1789802378995

CREATE TABLE `rd_capability` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`module_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `rd_module`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_capability_sort_order_non_negative" CHECK("rd_capability"."sort_order" >= 0),
	CONSTRAINT "rd_capability_status_allowed" CHECK("rd_capability"."status" in ('DRAFT', 'DESIGNED', 'IMPLEMENTING', 'TESTING', 'DONE', 'BLOCKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_capability_feature_code_unique` ON `rd_capability` (`feature_id`,`code`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rd_task` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`capability_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'OTHER' NOT NULL,
	`category` text DEFAULT 'OTHER' NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`design_revision_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`capability_id`) REFERENCES `rd_capability`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`design_revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_task_sort_order_non_negative" CHECK("__new_rd_task"."sort_order" >= 0),
	CONSTRAINT "rd_task_type_allowed" CHECK("__new_rd_task"."type" in ('DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER')),
	CONSTRAINT "rd_task_status_allowed" CHECK("__new_rd_task"."status" in ('PLANNED', 'AUTHORIZED', 'RUNNING', 'SUBMITTED', 'CONFIRMED', 'DONE', 'BLOCKED'))
);
--> statement-breakpoint
INSERT INTO `__new_rd_task`("id", "project_id", "feature_id", "capability_id", "code", "name", "type", "category", "area", "status", "objective", "design_revision_id", "sort_order", "created_at", "updated_at") SELECT "id", "project_id", "feature_id", null, "code", "name", "type", "category", "area", "status", "objective", "design_revision_id", "sort_order", "created_at", "updated_at" FROM `rd_task`;--> statement-breakpoint
DROP TABLE `rd_task`;--> statement-breakpoint
ALTER TABLE `__new_rd_task` RENAME TO `rd_task`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `rd_task_feature_code_unique` ON `rd_task` (`feature_id`,`code`);--> statement-breakpoint
DROP INDEX `rd_spec_feature_unique`;--> statement-breakpoint
DROP INDEX `rd_spec_project_kind_unique`;--> statement-breakpoint
ALTER TABLE `rd_spec` ADD `capability_id` text REFERENCES rd_capability(id);--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_capability_unique` ON `rd_spec` (`capability_id`) WHERE "rd_spec"."capability_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_feature_unique` ON `rd_spec` (`feature_id`) WHERE "rd_spec"."feature_id" is not null and "rd_spec"."capability_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_project_kind_unique` ON `rd_spec` (`project_id`,`kind`) WHERE "rd_spec"."feature_id" is null and "rd_spec"."capability_id" is null;--> statement-breakpoint
CREATE TABLE `__new_rd_ai_run` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`task_id` text NOT NULL,
	`authorization_id` text,
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
	CONSTRAINT "rd_ai_run_actor_type_allowed" CHECK("__new_rd_ai_run"."actor_type" in ('MANUAL', 'AI_TOKEN')),
	CONSTRAINT "rd_ai_run_status_allowed" CHECK("__new_rd_ai_run"."status" in ('RUNNING', 'SUBMITTED', 'FAILED', 'ABORTED')),
	CONSTRAINT "rd_ai_run_phase_allowed" CHECK("__new_rd_ai_run"."phase" in ('PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'))
);
--> statement-breakpoint
INSERT INTO `__new_rd_ai_run`("id", "project_id", "feature_id", "task_id", "authorization_id", "actor_type", "actor_name", "status", "phase", "base_commit", "result_commit", "summary", "changed_files", "verification_summary", "issues", "started_at", "submitted_at", "finished_at", "created_at", "updated_at") SELECT "id", "project_id", "feature_id", "task_id", "authorization_id", "actor_type", "actor_name", "status", "phase", "base_commit", "result_commit", "summary", "changed_files", "verification_summary", "issues", "started_at", "submitted_at", "finished_at", "created_at", "updated_at" FROM `rd_ai_run`;--> statement-breakpoint
DROP TABLE `rd_ai_run`;--> statement-breakpoint
ALTER TABLE `__new_rd_ai_run` RENAME TO `rd_ai_run`;--> statement-breakpoint
CREATE UNIQUE INDEX `rd_ai_run_running_task_unique` ON `rd_ai_run` (`task_id`) WHERE "rd_ai_run"."status" = 'RUNNING';--> statement-breakpoint
ALTER TABLE `rd_project` ADD `workflow_mode` text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE `rd_project` ADD `design_profile` text DEFAULT 'generic' NOT NULL;



-- forgeflow-legacy-step:1789806010657

CREATE TABLE `rd_engineering_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`module_id` text,
	`feature_id` text,
	`capability_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`summary` text DEFAULT '' NOT NULL,
	`structured_data` text,
	`content_markdown` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `rd_module`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`capability_id`) REFERENCES `rd_capability`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_engineering_asset_feature_kind_name_unique` ON `rd_engineering_asset` (`feature_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `rd_trace_link` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_trace_link_unique` ON `rd_trace_link` (`project_id`,`source_type`,`source_id`,`target_type`,`target_id`,`relation`);


-- forgeflow-legacy-step:1789821950134

CREATE TABLE `rd_project_source` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`alias` text NOT NULL,
	`display_name` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`source_kind` text NOT NULL,
	`remote_url` text,
	`repo_subdir` text,
	`scope_json` text,
	`locations_json` text NOT NULL,
	`status` text DEFAULT 'REGISTERED' NOT NULL,
	`last_idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_project_source_project_alias_unique` ON `rd_project_source` (`project_id`,`alias`);--> statement-breakpoint
CREATE UNIQUE INDEX `rd_project_source_idempotency_unique` ON `rd_project_source` (`project_id`,`last_idempotency_key`);--> statement-breakpoint
CREATE TABLE `rd_source_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requested_source_ids_json` text NOT NULL,
	`target_scope_json` text NOT NULL,
	`environment_key` text NOT NULL,
	`status` text DEFAULT 'WAITING_AI' NOT NULL,
	`source_snapshots_json` text,
	`checkpoint_json` text,
	`summary` text,
	`errors_json` text,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_source_analysis_status_allowed" CHECK("rd_source_analysis"."status" in ('WAITING_AI', 'READING', 'PARTIAL', 'SYNCED', 'FAILED', 'STALE'))
);



-- forgeflow-legacy-step:1789824280874

CREATE TABLE `rd_engineering_asset_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`structured_data` text,
	`content_markdown` text,
	`content_hash` text NOT NULL,
	`source` text DEFAULT 'unknown' NOT NULL,
	`change_summary` text DEFAULT '未记录（旧版）' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `rd_engineering_asset`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_engineering_asset_revision_no_positive" CHECK("rd_engineering_asset_revision"."revision_no" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_engineering_asset_revision_asset_no_unique` ON `rd_engineering_asset_revision` (`asset_id`,`revision_no`);--> statement-breakpoint
CREATE TRIGGER `rd_engineering_asset_revision_immutable_update`
BEFORE UPDATE ON `rd_engineering_asset_revision`
BEGIN
	SELECT RAISE(ABORT, 'engineering asset revisions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `rd_engineering_asset_revision_immutable_delete`
BEFORE DELETE ON `rd_engineering_asset_revision`
BEGIN
	SELECT RAISE(ABORT, 'engineering asset revisions are immutable');
END;--> statement-breakpoint
ALTER TABLE `rd_ai_run` ADD `design_snapshot_json` text DEFAULT '{"specifications":[],"engineeringAssets":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `rd_ai_run` ADD `source_executions_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `rd_engineering_asset` ADD `current_revision_id` text REFERENCES rd_engineering_asset_revision(id);--> statement-breakpoint
INSERT INTO `rd_engineering_asset_revision` (
	`id`, `asset_id`, `revision_no`, `structured_data`, `content_markdown`, `content_hash`, `source`, `change_summary`, `created_at`
)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`id`, 1, `structured_data`, `content_markdown`, forgeflow_engineering_hash(`structured_data`, `content_markdown`), 'migration:pre-baseline', '迁移现有工程设计为 REV 1', `created_at`
FROM `rd_engineering_asset`
WHERE `current_revision_id` IS NULL;--> statement-breakpoint
UPDATE `rd_engineering_asset`
SET `current_revision_id` = (
	SELECT `revision`.`id`
	FROM `rd_engineering_asset_revision` AS `revision`
	WHERE `revision`.`asset_id` = `rd_engineering_asset`.`id` AND `revision`.`revision_no` = 1
)
WHERE `current_revision_id` IS NULL;
