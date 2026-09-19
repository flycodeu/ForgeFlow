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
