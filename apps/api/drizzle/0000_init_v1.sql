CREATE TABLE `alert_history` (
	`alert_id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`device_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`details_json` text,
	`triggered_at` text NOT NULL,
	`acknowledged_at` text,
	`acknowledged_by` text,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_alert_history_status` ON `alert_history` (`status`,`triggered_at`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`rule_id` text PRIMARY KEY NOT NULL,
	`metric` text NOT NULL,
	`device_type` text NOT NULL,
	`device_id` text,
	`operator` text NOT NULL,
	`threshold` real NOT NULL,
	`unit` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`severity` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_states` (
	`state_key` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`device_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`state` text NOT NULL,
	`pending_since` text,
	`firing_since` text,
	`last_evaluated_at` text NOT NULL,
	`payload_json` text
);
--> statement-breakpoint
CREATE TABLE `analysis_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` text NOT NULL,
	`device_id` text NOT NULL,
	`severity` text NOT NULL,
	`score` real,
	`engine_version` text NOT NULL,
	`rule_version` text NOT NULL,
	`threshold_source` text NOT NULL,
	`factors_json` text NOT NULL,
	`analyzed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_device_time` ON `analysis_results` (`device_id`,`analyzed_at`);--> statement-breakpoint
CREATE TABLE `app_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_sessions_token_hash_unique` ON `app_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `app_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`is_sensitive` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `app_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_username_unique` ON `app_users` (`username`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text,
	`actor_username` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`details_json` text,
	`ip_address` text,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_time` ON `audit_logs` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `collector_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` text NOT NULL,
	`collector_name` text NOT NULL,
	`status` text NOT NULL,
	`capability_status` text NOT NULL,
	`interval_seconds` integer NOT NULL,
	`last_run_at` text,
	`last_success_at` text,
	`consecutive_failures` integer NOT NULL,
	`last_error_code` text,
	`last_error_message` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`host_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_collector_status_host_name` ON `collector_status` (`host_id`,`collector_name`);--> statement-breakpoint
CREATE TABLE `device_identities` (
	`device_id` text PRIMARY KEY NOT NULL,
	`stable` integer NOT NULL,
	`pci_bus_id` text,
	`pci_vendor_id` text,
	`pci_device_id` text,
	`wwn` text,
	`serial` text,
	`nvme_nguid` text,
	`driver` text,
	`raw_path` text,
	`topology` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`device_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`device_id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`device_type` text NOT NULL,
	`vendor` text NOT NULL,
	`model` text NOT NULL,
	`name` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`device_status` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`host_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_devices_host` ON `devices` (`host_id`);--> statement-breakpoint
CREATE TABLE `health_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diagnostic_id` text NOT NULL,
	`host_id` text NOT NULL,
	`device_id` text,
	`collector_name` text,
	`level` text NOT NULL,
	`error_code` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`remediation` text,
	`details_json` text,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_health_events_time` ON `health_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `hosts` (
	`host_id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`os_name` text NOT NULL,
	`os_version` text NOT NULL,
	`kernel_version` text NOT NULL,
	`architecture` text NOT NULL,
	`agent_version` text NOT NULL,
	`boot_time` text,
	`uptime_seconds` integer,
	`last_seen_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ipc_cursors` (
	`agent_instance_id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`last_sequence` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`ip_address` text NOT NULL,
	`succeeded` integer NOT NULL,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_user_time` ON `login_attempts` (`username`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `sensor_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` text NOT NULL,
	`device_id` text NOT NULL,
	`sensor_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real,
	`unit` text NOT NULL,
	`quality` text NOT NULL,
	`source` text NOT NULL,
	`collected_at` text NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`sensor_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sensor_readings_sensor_time` ON `sensor_readings` (`sensor_id`,`collected_at`);--> statement-breakpoint
CREATE INDEX `idx_sensor_readings_collected_at` ON `sensor_readings` (`collected_at`);--> statement-breakpoint
CREATE TABLE `sensor_readings_1h` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sensor_id` text NOT NULL,
	`bucket_start` text NOT NULL,
	`min_value` real,
	`max_value` real,
	`avg_value` real,
	`sample_count` integer NOT NULL,
	`valid_count` integer NOT NULL,
	FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`sensor_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sensor_readings_1h_sensor_bucket` ON `sensor_readings_1h` (`sensor_id`,`bucket_start`);--> statement-breakpoint
CREATE TABLE `sensor_readings_1m` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sensor_id` text NOT NULL,
	`bucket_start` text NOT NULL,
	`min_value` real,
	`max_value` real,
	`avg_value` real,
	`sample_count` integer NOT NULL,
	`valid_count` integer NOT NULL,
	FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`sensor_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sensor_readings_1m_sensor_bucket` ON `sensor_readings_1m` (`sensor_id`,`bucket_start`);--> statement-breakpoint
CREATE TABLE `sensors` (
	`sensor_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`host_id` text NOT NULL,
	`sensor_type` text NOT NULL,
	`sensor_name` text NOT NULL,
	`source` text NOT NULL,
	`unit` text NOT NULL,
	`capability_status` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`device_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`host_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sensors_device` ON `sensors` (`device_id`);--> statement-breakpoint
CREATE TABLE `smart_attributes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`smart_device_row_id` integer NOT NULL,
	`device_id` text NOT NULL,
	`attr_id` integer NOT NULL,
	`name` text NOT NULL,
	`value` integer,
	`worst` integer,
	`threshold` integer,
	`raw_value` text NOT NULL,
	`raw_string` text,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`smart_device_row_id`) REFERENCES `smart_devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_smart_attrs_row` ON `smart_attributes` (`smart_device_row_id`);--> statement-breakpoint
CREATE TABLE `smart_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` text NOT NULL,
	`device_id` text NOT NULL,
	`device_path` text NOT NULL,
	`protocol_type` text NOT NULL,
	`device_status` text NOT NULL,
	`smart_passed` integer,
	`temperature_celsius` real,
	`power_on_hours` text,
	`power_cycles` text,
	`data_units_read` text,
	`data_units_written` text,
	`percentage_used` real,
	`available_spare` real,
	`critical_warning` integer,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`device_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_smart_devices_device_time` ON `smart_devices` (`device_id`,`collected_at`);