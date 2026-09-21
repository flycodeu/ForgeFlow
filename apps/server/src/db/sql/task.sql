-- ==============================================================================
-- ForgeFlow 数据库模块: 研发任务与执行授权 (Task, Authorization & AI Run)
-- 包含: 研发任务表 (rd_task)、任务执行授权 (rd_task_authorization)、AI 执行记录 (rd_ai_run)
-- ==============================================================================

-- 1. 研发任务表 (支持需求设计、后端研发、前端、联调验证等分类任务)
CREATE TABLE IF NOT EXISTS `rd_task` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`capability_id`) REFERENCES `rd_capability`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`design_revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_task_sort_order_non_negative" CHECK("rd_task"."sort_order" >= 0),
	CONSTRAINT "rd_task_type_allowed" CHECK("rd_task"."type" IN ('DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER')),
	CONSTRAINT "rd_task_status_allowed" CHECK("rd_task"."status" IN ('PLANNED', 'AUTHORIZED', 'RUNNING', 'SUBMITTED', 'CONFIRMED', 'DONE', 'BLOCKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_task_feature_code_unique` 
	ON `rd_task` (`feature_id`, `code`);

-- 2. 任务执行授权表 (控制 AI 或人员介入特定任务的有效授权周期)
CREATE TABLE IF NOT EXISTS `rd_task_authorization` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`authorized_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `rd_task`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_task_authorization_status_allowed" CHECK("rd_task_authorization"."status" IN ('ACTIVE', 'REVOKED', 'CONSUMED')),
	CONSTRAINT "rd_task_authorization_revoked_time" CHECK(
		("rd_task_authorization"."status" = 'REVOKED' AND "rd_task_authorization"."revoked_at" IS NOT NULL) 
		OR ("rd_task_authorization"."status" != 'REVOKED' AND "rd_task_authorization"."revoked_at" IS NULL)
	)
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_task_authorization_active_unique` 
	ON `rd_task_authorization` (`task_id`) 
	WHERE "rd_task_authorization"."status" = 'ACTIVE';

-- 3. AI 运行执行记录表 (记录任务全流程上下文、阶段变更与产物提交)
CREATE TABLE IF NOT EXISTS `rd_ai_run` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`task_id`) REFERENCES `rd_task`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`authorization_id`) REFERENCES `rd_task_authorization`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_ai_run_actor_type_allowed" CHECK("rd_ai_run"."actor_type" IN ('MANUAL', 'AI_TOKEN')),
	CONSTRAINT "rd_ai_run_status_allowed" CHECK("rd_ai_run"."status" IN ('RUNNING', 'SUBMITTED', 'FAILED', 'ABORTED')),
	CONSTRAINT "rd_ai_run_phase_allowed" CHECK("rd_ai_run"."phase" IN ('PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'))
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_ai_run_running_task_unique` 
	ON `rd_ai_run` (`task_id`) 
	WHERE "rd_ai_run"."status" = 'RUNNING';
