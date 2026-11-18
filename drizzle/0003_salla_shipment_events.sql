CREATE TABLE `salla_shipment_events` (
	`brand_id` text NOT NULL,
	`shipment_id` text NOT NULL,
	`order_id` text,
	`tracking` text,
	`shipping_number` text,
	`event_at` text NOT NULL,
	`event_rank` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `salla_connections`(`brand_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_salla_shipment_event_key` ON `salla_shipment_events` (`brand_id`,`shipment_id`);--> statement-breakpoint
CREATE INDEX `idx_salla_event_tracking` ON `salla_shipment_events` (`brand_id`,`tracking`);--> statement-breakpoint
CREATE INDEX `idx_salla_event_shipping_number` ON `salla_shipment_events` (`brand_id`,`shipping_number`);--> statement-breakpoint
CREATE INDEX `idx_salla_event_expiry` ON `salla_shipment_events` (`expires_at`);