CREATE TABLE `brand_order_categories` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`configuration` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_order_categories` (
	`file_id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`rule_id` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `salla_connections` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`credentials` text NOT NULL,
	`expires_at` integer NOT NULL,
	`event_at` text NOT NULL,
	`refresh_claim` text,
	`indexed_at` integer,
	`index_complete` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salla_connections_merchant_id_unique` ON `salla_connections` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `salla_order_products` (
	`brand_id` text NOT NULL,
	`ref` text NOT NULL,
	`products` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `salla_connections`(`brand_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_salla_order_products_ref` ON `salla_order_products` (`brand_id`,`ref`);--> statement-breakpoint
CREATE TABLE `salla_shipments` (
	`brand_id` text NOT NULL,
	`shipment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`tracking` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `salla_connections`(`brand_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_salla_shipment_key` ON `salla_shipments` (`brand_id`,`shipment_id`,`tracking`);--> statement-breakpoint
CREATE INDEX `idx_salla_tracking` ON `salla_shipments` (`brand_id`,`tracking`);--> statement-breakpoint
CREATE TABLE `scanner_login_limits` (
	`subject` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scanner_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`credential_version` text NOT NULL,
	`expires_at` integer NOT NULL
);
