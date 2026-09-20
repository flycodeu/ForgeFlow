CREATE TRIGGER IF NOT EXISTS `rd_work_event_no_update` BEFORE UPDATE ON `rd_work_event`
BEGIN SELECT RAISE(ABORT, 'Work events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `rd_work_event_no_delete` BEFORE DELETE ON `rd_work_event`
BEGIN SELECT RAISE(ABORT, 'Work events are append-only'); END;
