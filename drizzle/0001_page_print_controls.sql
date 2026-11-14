CREATE TABLE `batch_print_refs` (
	`file_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`ref` text NOT NULL,
	`expires_at` text NOT NULL,
	`version` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_batch_print_identity` ON `batch_print_refs` (`file_id`,`brand_id`,`ref`);--> statement-breakpoint
CREATE INDEX `idx_batch_print_ref` ON `batch_print_refs` (`brand_id`,`ref`);--> statement-breakpoint
CREATE INDEX `idx_batch_print_expiry` ON `batch_print_refs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `file_page_exclusions` (
	`file_id` text NOT NULL,
	`page` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_file_page_exclusion` ON `file_page_exclusions` (`file_id`,`page`);--> statement-breakpoint
CREATE TABLE `file_print_batches` (
	`file_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`pages` text NOT NULL,
	`issued_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shipment_print_controls` (
	`brand_id` text NOT NULL,
	`ref` text NOT NULL,
	`tracking` text NOT NULL,
	`state` text NOT NULL,
	`source_file_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`changed_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shipment_print_identity` ON `shipment_print_controls` (`brand_id`,`ref`,`tracking`);--> statement-breakpoint
CREATE INDEX `idx_shipment_print_expiry` ON `shipment_print_controls` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_occurrences_file_page` ON `occurrences` (`file_id`,`page`);