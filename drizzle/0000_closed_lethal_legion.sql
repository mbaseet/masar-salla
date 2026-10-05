CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`file_id` text,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_brand_date` ON `audit` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_file` ON `audit` (`file_id`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`identifiers` text NOT NULL,
	`columns` text NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`archive_days` integer DEFAULT 7 NOT NULL,
	`index_days` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`hash` text,
	`object_key` text NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`stage` text DEFAULT 'awaiting' NOT NULL,
	`bucket` text DEFAULT 'unknown' NOT NULL,
	`detected_brand_id` text,
	`page_count` integer DEFAULT 0 NOT NULL,
	`waybill_count` integer DEFAULT 0 NOT NULL,
	`carriers` text DEFAULT '[]' NOT NULL,
	`uploaded_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`printed_at` text,
	`shipped_at` text,
	`changed_version` integer DEFAULT 0 NOT NULL,
	`ack_version` integer DEFAULT 0 NOT NULL,
	`reviewed_at` text,
	`created_by` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_files_brand_expiry` ON `files` (`brand_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_files_brand_hash` ON `files` (`brand_id`,`hash`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text,
	`page` integer,
	`related_file_id` text,
	`related_page` integer,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_note` text,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `findings_fingerprint_unique` ON `findings` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_findings_file_status` ON `findings` (`file_id`,`status`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`file_id` text,
	`ref` text,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notes_brand_ref` ON `notes` (`brand_id`,`ref`);--> statement-breakpoint
CREATE INDEX `idx_notes_file` ON `notes` (`file_id`);--> statement-breakpoint
CREATE TABLE `occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`page` integer NOT NULL,
	`ref` text NOT NULL,
	`tracking` text,
	`quantity` integer,
	`carrier` text NOT NULL,
	`source_date` text,
	`date_type` text,
	`page_role` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_occurrences_brand_ref` ON `occurrences` (`brand_id`,`ref`);--> statement-breakpoint
CREATE INDEX `idx_occurrences_file` ON `occurrences` (`file_id`);--> statement-breakpoint
CREATE TABLE `order_index` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`ref` text NOT NULL,
	`file_name` text NOT NULL,
	`page` integer NOT NULL,
	`uploaded_at` text NOT NULL,
	`stage` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_order_index_ref` ON `order_index` (`ref`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`page` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pages_file_page` ON `pages` (`file_id`,`page`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'operator' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);