-- ==============================================================================
-- ForgeFlow 数据库模块: 工程设计与蓝图资料 (Engineering Specifications & Blueprints)
-- 包含: 设计资料 (rd_spec)、不可变版本历史 (rd_spec_revision)、人工评审 (rd_design_review)、
--       工程资产 (rd_engineering_asset)、资产版本 (rd_engineering_asset_revision)、全链路追踪 (rd_trace_link)
-- ==============================================================================

-- 1. 设计资料版本表 (内容不可变，通过触发器保证)
CREATE TABLE IF NOT EXISTS `rd_spec_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`spec_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`markdown` text NOT NULL,
	`content_hash` text NOT NULL,
	`source` text DEFAULT 'unknown' NOT NULL,
	`change_summary` text DEFAULT '未记录（旧版）' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "rd_spec_revision_no_positive" CHECK("rd_spec_revision"."revision_no" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_spec_revision_spec_no_unique` 
	ON `rd_spec_revision` (`spec_id`, `revision_no`);

-- 2. 项目与功能设计资料主表
CREATE TABLE IF NOT EXISTS `rd_spec` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`feature_id` text,
	`capability_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`latest_revision_id` text,
	`approved_revision_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`capability_id`) REFERENCES `rd_capability`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`latest_revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`approved_revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_spec_feature_unique` 
	ON `rd_spec` (`feature_id`) 
	WHERE "rd_spec"."feature_id" IS NOT NULL AND "rd_spec"."capability_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `rd_spec_capability_unique` 
	ON `rd_spec` (`capability_id`) 
	WHERE "rd_spec"."capability_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `rd_spec_project_kind_unique` 
	ON `rd_spec` (`project_id`, `kind`) 
	WHERE "rd_spec"."feature_id" IS NULL AND "rd_spec"."capability_id" IS NULL;

-- 3. 设计评审表
CREATE TABLE IF NOT EXISTS `rd_design_review` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`spec_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`submitted_at` integer NOT NULL,
	`decided_at` integer,
	`decision_comment` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`spec_id`) REFERENCES `rd_spec`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`revision_id`) REFERENCES `rd_spec_revision`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_design_review_status_allowed" CHECK("rd_design_review"."status" IN (
		'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED'
	)),
	CONSTRAINT "rd_design_review_decision_time" CHECK(
		("rd_design_review"."status" = 'PENDING' AND "rd_design_review"."decided_at" IS NULL) OR
		("rd_design_review"."status" != 'PENDING' AND "rd_design_review"."decided_at" IS NOT NULL)
	)
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_design_review_revision_pending_unique` 
	ON `rd_design_review` (`revision_id`) 
	WHERE "rd_design_review"."status" = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS `rd_design_review_spec_pending_unique` 
	ON `rd_design_review` (`spec_id`) 
	WHERE "rd_design_review"."status" = 'PENDING';

-- 4. 工程资产 (数据模型、接口契约、UI设计等)
CREATE TABLE IF NOT EXISTS `rd_engineering_asset` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`module_id`) REFERENCES `rd_module`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`feature_id`) REFERENCES `rd_feature`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	FOREIGN KEY (`capability_id`) REFERENCES `rd_capability`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_engineering_asset_feature_kind_name_unique` 
	ON `rd_engineering_asset` (`feature_id`, `kind`, `name`);

-- 5. 工程资产版本历史表 (结构化数据 + Markdown)
CREATE TABLE IF NOT EXISTS `rd_engineering_asset_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`structured_data` text,
	`content_markdown` text,
	`content_hash` text NOT NULL,
	`source` text DEFAULT 'unknown' NOT NULL,
	`change_summary` text DEFAULT '未记录（旧版）' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `rd_engineering_asset`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_engineering_asset_revision_no_positive" CHECK("rd_engineering_asset_revision"."revision_no" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_engineering_asset_revision_asset_no_unique` 
	ON `rd_engineering_asset_revision` (`asset_id`, `revision_no`);

-- 6. 全链路追踪关系表
CREATE TABLE IF NOT EXISTS `rd_trace_link` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_trace_link_unique` 
	ON `rd_trace_link` (`project_id`, `source_type`, `source_id`, `target_type`, `target_id`, `relation`);

-- 7. 不可变性保护触发器
CREATE TRIGGER IF NOT EXISTS `rd_spec_revision_no_update`
BEFORE UPDATE ON `rd_spec_revision`
BEGIN
	SELECT RAISE(ABORT, 'Specification revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS `rd_spec_revision_no_delete`
BEFORE DELETE ON `rd_spec_revision`
BEGIN
	SELECT RAISE(ABORT, 'Specification revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS `rd_engineering_asset_revision_immutable_update`
BEFORE UPDATE ON `rd_engineering_asset_revision`
BEGIN
	SELECT RAISE(ABORT, 'engineering asset revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS `rd_engineering_asset_revision_immutable_delete`
BEFORE DELETE ON `rd_engineering_asset_revision`
BEGIN
	SELECT RAISE(ABORT, 'engineering asset revisions are immutable');
END;
