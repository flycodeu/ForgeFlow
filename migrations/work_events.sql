CREATE TABLE `rd_work_event` (
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
	FOREIGN KEY (`project_id`) REFERENCES `rd_project`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rd_work_event_type_allowed" CHECK("rd_work_event"."type" in ('PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE')),
	CONSTRAINT "rd_work_event_source_allowed" CHECK("rd_work_event"."source_kind" in ('owner', 'local_web', 'ai_token'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_work_event_id_unique` ON `rd_work_event` (`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `rd_work_event_operation_unique` ON `rd_work_event` (`project_id`,`principal_key`,`operation_id`);
--> statement-breakpoint
CREATE INDEX `rd_work_event_project_sequence` ON `rd_work_event` (`project_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `rd_work_event_work_sequence` ON `rd_work_event` (`project_id`,`work_id`,`sequence`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `rd_work_event_no_update` BEFORE UPDATE ON `rd_work_event`
BEGIN SELECT RAISE(ABORT, 'Work events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `rd_work_event_no_delete` BEFORE DELETE ON `rd_work_event`
BEGIN SELECT RAISE(ABORT, 'Work events are append-only'); END;
