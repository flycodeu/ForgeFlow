-- ForgeFlow complete database schema.
-- This is the baseline for new installations; future changes use named migrations.
CREATE TABLE `rd_ai_run` (
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
	`design_snapshot_json` text DEFAULT '{"specifications":[],"engineeringAssets":[]}' NOT NULL,
	`source_executions_json` text DEFAULT '[]' NOT NULL,
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
	`current_revision_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `rd_module`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`capability_id`) REFERENCES `rd_capability`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_revision_id`) REFERENCES `rd_engineering_asset_revision`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_engineering_asset_feature_kind_name_unique` ON `rd_engineering_asset` (`feature_id`,`kind`,`name`);--> statement-breakpoint
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
--> statement-breakpoint
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
CREATE TABLE `rd_project` (
	`id` text PRIMARY KEY NOT NULL,
	`project_key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_type` text DEFAULT 'GENERAL' NOT NULL,
	`workflow_mode` text DEFAULT 'AUTO' NOT NULL,
	`design_profile` text DEFAULT 'generic' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_project_project_key_unique` ON `rd_project` (`project_key`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `rd_spec_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`spec_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`markdown` text NOT NULL,
	`content_hash` text NOT NULL,
	`source` text DEFAULT 'unknown' NOT NULL,
	`change_summary` text DEFAULT '未记录（旧版）' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`spec_id`) REFERENCES `rd_spec`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_spec_revision_no_positive" CHECK("rd_spec_revision"."revision_no" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_revision_spec_no_unique` ON `rd_spec_revision` (`spec_id`,`revision_no`);--> statement-breakpoint
CREATE TABLE `rd_spec` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`capability_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`latest_revision_id` text,
	`approved_revision_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`capability_id`) REFERENCES `rd_capability`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`latest_revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_feature_unique` ON `rd_spec` (`feature_id`) WHERE "rd_spec"."feature_id" is not null and "rd_spec"."capability_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_capability_unique` ON `rd_spec` (`capability_id`) WHERE "rd_spec"."capability_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `rd_spec_project_kind_unique` ON `rd_spec` (`project_id`,`kind`) WHERE "rd_spec"."feature_id" is null and "rd_spec"."capability_id" is null;--> statement-breakpoint
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
CREATE UNIQUE INDEX `rd_task_authorization_active_unique` ON `rd_task_authorization` (`task_id`) WHERE "rd_task_authorization"."status" = 'ACTIVE';--> statement-breakpoint
CREATE TABLE `rd_task` (
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
	CONSTRAINT "rd_task_sort_order_non_negative" CHECK("rd_task"."sort_order" >= 0),
	CONSTRAINT "rd_task_type_allowed" CHECK("rd_task"."type" in ('DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER')),
	CONSTRAINT "rd_task_status_allowed" CHECK("rd_task"."status" in ('PLANNED', 'AUTHORIZED', 'RUNNING', 'SUBMITTED', 'CONFIRMED', 'DONE', 'BLOCKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_task_feature_code_unique` ON `rd_task` (`feature_id`,`code`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `rd_spec_revision_no_update`
BEFORE UPDATE ON `rd_spec_revision`
BEGIN
	SELECT RAISE(ABORT, 'Specification revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `rd_spec_revision_no_delete`
BEFORE DELETE ON `rd_spec_revision`
BEGIN
	SELECT RAISE(ABORT, 'Specification revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `rd_engineering_asset_revision_immutable_update`
BEFORE UPDATE ON `rd_engineering_asset_revision`
BEGIN
	SELECT RAISE(ABORT, 'engineering asset revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `rd_engineering_asset_revision_immutable_delete`
BEFORE DELETE ON `rd_engineering_asset_revision`
BEGIN
	SELECT RAISE(ABORT, 'engineering asset revisions are immutable');
END;
