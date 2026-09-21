-- ==============================================================================
-- ForgeFlow 数据库模块: 工作事件流与审计存证 (Work Event Stream & Audit Trail)
-- 包含: 工作事件表 (rd_work_event)、防篡改不可变触发器 (Immutable Triggers)
-- ==============================================================================

-- 1. 工作事件日志表 (记录计划、进度、设计、交付结果、研讨备忘等不可变事件)
CREATE TABLE IF NOT EXISTS `rd_work_event` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_id` text NOT NULL,
	`principal_key` text NOT NULL,
	`operation_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_name` text NOT NULL,
	`document_revision_ids_json` text DEFAULT '[]' NOT NULL,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT,
	CONSTRAINT "rd_work_event_type_allowed" CHECK("rd_work_event"."type" IN ('PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE')),
	CONSTRAINT "rd_work_event_source_allowed" CHECK("rd_work_event"."source_kind" IN ('owner', 'local_web', 'ai_token'))
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_work_event_id_unique` 
	ON `rd_work_event` (`id`);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_work_event_operation_unique` 
	ON `rd_work_event` (`project_id`, `principal_key`, `operation_id`);

CREATE INDEX IF NOT EXISTS `rd_work_event_project_sequence` 
	ON `rd_work_event` (`project_id`, `sequence`);

CREATE INDEX IF NOT EXISTS `rd_work_event_work_sequence` 
	ON `rd_work_event` (`project_id`, `work_id`, `sequence`);

-- 2. 防篡改不可变触发器 (事件流一旦写入禁止更新或删除)
CREATE TRIGGER IF NOT EXISTS `rd_work_event_no_update` 
BEFORE UPDATE ON `rd_work_event`
BEGIN 
	SELECT RAISE(ABORT, 'Work events are append-only'); 
END;

CREATE TRIGGER IF NOT EXISTS `rd_work_event_no_delete` 
BEFORE DELETE ON `rd_work_event`
BEGIN 
	SELECT RAISE(ABORT, 'Work events are append-only'); 
END;
