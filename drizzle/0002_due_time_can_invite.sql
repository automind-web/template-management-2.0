ALTER TABLE `memberships` ADD `can_invite` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `due_time` text;--> statement-breakpoint
UPDATE `memberships` SET `can_invite` = 1 WHERE `role` = 'manager';
