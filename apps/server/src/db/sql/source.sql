-- ==============================================================================
-- ForgeFlow 数据库模块: 源码仓库与工程解析 (Source Repository & Analysis)
-- 包含: 项目代码源 (rd_project_source)、源码快照分析任务 (rd_source_analysis)
-- ==============================================================================

-- 1. 项目代码源表 (管理 Git 仓库源、本地目录映射、同步范围及状态)
CREATE TABLE IF NOT EXISTS `rd_project_source` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_project_source_project_alias_unique` 
	ON `rd_project_source` (`project_id`, `alias`);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_project_source_idempotency_unique` 
	ON `rd_project_source` (`project_id`, `last_idempotency_key`);

-- 2. 源码快照与结构解析记录表
CREATE TABLE IF NOT EXISTS `rd_source_analysis` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_source_analysis_status_allowed" CHECK("rd_source_analysis"."status" IN ('WAITING_AI', 'READING', 'PARTIAL', 'SYNCED', 'FAILED', 'STALE'))
);
