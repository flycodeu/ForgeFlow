-- ==============================================================================
-- ForgeFlow 数据库模块: 认证与安全凭证 (Authentication & Security)
-- 包含: 用户主表 (rd_owner)、用户会话 (rd_owner_session)、AI 客户端凭证 (rd_ai_token)
-- ==============================================================================

-- 1. 系统单用户管理员表 (单例约束: id = 1)
CREATE TABLE IF NOT EXISTS `rd_owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "rd_owner_singleton" CHECK("rd_owner"."id" = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_owner_username_unique` 
	ON `rd_owner` (`username`);

-- 2. 管理员会话表
CREATE TABLE IF NOT EXISTS `rd_owner_session` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`owner_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `rd_owner`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);

-- 3. AI 客户端令牌凭证表 (用于 Codex / Claude Code / MCP 接入)
CREATE TABLE IF NOT EXISTS `rd_ai_token` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `rd_owner`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `rd_ai_token_token_hash_unique` 
	ON `rd_ai_token` (`token_hash`);
