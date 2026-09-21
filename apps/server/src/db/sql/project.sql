-- ==============================================================================
-- ForgeFlow 数据库模块: 项目与架构层级 (Project Hierarchy)
-- 包含: 项目表 (rd_project)、模块分组 (rd_module)、功能定义 (rd_feature)、能力明细 (rd_capability)
-- ==============================================================================

-- 1. 项目基础表
CREATE TABLE IF NOT EXISTS `rd_project` (
	`id` text PRIMARY KEY NOT NULL,
	`project_key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_type` text DEFAULT 'GENERAL' NOT NULL,
	`workflow_mode` text DEFAULT 'AUTO' NOT NULL,
	`design_profile` text DEFAULT 'generic' NOT NULL,
	`created_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_project_project_key_unique` 
	ON `rd_project` (`project_key`);

-- 2. 架构模块分组表
CREATE TABLE IF NOT EXISTS `rd_module` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_module_sort_order_non_negative" CHECK("rd_module"."sort_order" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_module_project_code_unique` 
	ON `rd_module` (`project_id`, `code`);

-- 3. 系统功能清单表
CREATE TABLE IF NOT EXISTS `rd_feature` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`module_id`) REFERENCES `rd_module`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_feature_sort_order_non_negative" CHECK("rd_feature"."sort_order" >= 0),
	CONSTRAINT "rd_feature_status_allowed" CHECK("rd_feature"."status" IN (
		'DRAFT', 'DESIGNING', 'READY', 'IMPLEMENTING', 'VERIFYING', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'DELIVERED'
	))
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_feature_project_code_unique` 
	ON `rd_feature` (`project_id`, `code`);

-- 4. 原子能力项明细表
CREATE TABLE IF NOT EXISTS `rd_capability` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`module_id`) REFERENCES `rd_module`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_capability_sort_order_non_negative" CHECK("rd_capability"."sort_order" >= 0),
	CONSTRAINT "rd_capability_status_allowed" CHECK("rd_capability"."status" IN (
		'DRAFT', 'DESIGNED', 'IMPLEMENTING', 'TESTING', 'DONE', 'BLOCKED'
	))
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_capability_feature_code_unique` 
	ON `rd_capability` (`feature_id`, `code`);
