ALTER TABLE `smart_devices` ADD `firmware_version` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `serial_number` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `rotation_rate_rpm` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `sata_link_speed` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `apm_level` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `write_cache_enabled` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `trim_supported` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `self_test_passed` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `self_test_last_status` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `self_test_last_hours` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `error_log_count` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `media_errors` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `num_err_log_entries` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `unsafe_shutdowns` text;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `warning_temp_time_min` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `critical_comp_time_min` integer;
--> statement-breakpoint
ALTER TABLE `smart_devices` ADD `temperature_sensors_json` text;
