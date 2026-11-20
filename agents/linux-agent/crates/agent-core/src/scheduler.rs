use crate::collector::{CollectResult, CollectionTask, Collector, CollectorContext};
use crate::coverage::{CoverageReport, build_coverage_report};
use crate::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, Diagnostic, DiagnosticLevel,
    Sensor, SensorReading, SmartReport,
};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub devices: Vec<Device>,
    pub sensors: Vec<Sensor>,
    pub readings: Vec<SensorReading>,
    pub smart_reports: Vec<SmartReport>,
    pub collector_statuses: Vec<CollectorStatus>,
    pub diagnostics: Vec<Diagnostic>,
    pub coverage: CoverageReport,
}

/// Output of one low-overhead daemon tick (caches discovery & respects per-task intervals).
#[derive(Debug, Clone)]
pub struct TickSnapshot {
    pub inventory_refreshed: bool,
    pub snapshot: Snapshot,
}

/// Coordinates discovery and isolated task collection across all collectors.
/// Guarantees that a timeout, error, or panic in any single collector NEVER crashes the agent.
pub struct AgentRunner {
    collectors: Vec<Arc<dyn Collector>>,
    ctx: CollectorContext,
    last_wall_clock: Option<SystemTime>,
    cached_devices: Vec<Device>,
    cached_sensors: Vec<Sensor>,
    cached_tasks: Vec<(Arc<dyn Collector>, CollectionTask)>,
    last_discovery: Option<Instant>,
    last_task_run: HashMap<String, Instant>,
    task_min_interval: HashMap<String, Duration>,
}

impl AgentRunner {
    pub fn new(collectors: Vec<Arc<dyn Collector>>, ctx: CollectorContext) -> Self {
        Self {
            collectors,
            ctx,
            last_wall_clock: None,
            cached_devices: Vec::new(),
            cached_sensors: Vec::new(),
            cached_tasks: Vec::new(),
            last_discovery: None,
            last_task_run: HashMap::new(),
            task_min_interval: HashMap::new(),
        }
    }

    /// Detects backward wall-clock jumps (e.g. NTP step) and emits a diagnostic.
    fn check_wall_clock(&mut self, diagnostics: &mut Vec<Diagnostic>) {
        let now = SystemTime::now();
        if let Some(prev) = self.last_wall_clock
            && now < prev
        {
            diagnostics.push(Diagnostic {
                diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                host_id: self.ctx.host_id.clone(),
                device_id: None,
                collector_name: Some("scheduler".to_owned()),
                level: DiagnosticLevel::Warn,
                error_code: "WALL_CLOCK_ROLLBACK".to_owned(),
                source: "scheduler".to_owned(),
                message: "Detected backward wall-clock jump; monotonic intervals preserved"
                    .to_owned(),
                remediation: Some("Verify host NTP synchronization status".to_owned()),
                occurred_at: utc_now_rfc3339(),
                details: None,
            });
        }
        self.last_wall_clock = Some(now);
    }

    /// Executes one complete isolated discovery + collection pass across all collectors.
    pub async fn run_once(&mut self, discovery_timeout: Duration) -> Snapshot {
        let mut devices = Vec::new();
        let mut sensors = Vec::new();
        let mut tasks: Vec<(Arc<dyn Collector>, CollectionTask)> = Vec::new();
        let mut readings = Vec::new();
        let mut smart_reports = Vec::new();
        let mut diagnostics = Vec::new();
        let mut statuses: BTreeMap<String, CollectorStatus> = BTreeMap::new();

        self.check_wall_clock(&mut diagnostics);

        // Phase 1: isolated discovery per collector
        for collector in &self.collectors {
            let name = collector.name().to_owned();
            let c = Arc::clone(collector);
            let ctx = self.ctx.clone();

            let handle = tokio::spawn(async move {
                tokio::time::timeout(discovery_timeout, c.discover(&ctx)).await
            });

            match handle.await {
                Ok(Ok(disc)) => {
                    devices.extend(disc.devices);
                    sensors.extend(disc.sensors);
                    diagnostics.extend(disc.diagnostics);
                    for task in disc.tasks {
                        tasks.push((Arc::clone(collector), task));
                    }
                    statuses.insert(name, collector.health_check());
                }
                Ok(Err(_elapsed)) => {
                    let diag = self.failure_diag(
                        &name,
                        "COLLECTOR_DISCOVERY_TIMEOUT",
                        format!("Collector '{name}' discovery timed out"),
                    );
                    diagnostics.push(diag);
                    statuses.insert(
                        name.clone(),
                        self.error_status(
                            &name,
                            "COLLECTOR_DISCOVERY_TIMEOUT",
                            "discovery timed out",
                        ),
                    );
                }
                Err(join_err) => {
                    let msg = format!("Collector '{name}' panicked during discovery: {join_err}");
                    let diag = self.failure_diag(&name, "COLLECTOR_PANIC", msg.clone());
                    diagnostics.push(diag);
                    statuses.insert(
                        name.clone(),
                        self.error_status(&name, "COLLECTOR_PANIC", &msg),
                    );
                }
            }
        }

        // Phase 2: isolated task collection per (collector, task)
        for (collector, task) in tasks {
            let name = collector.name().to_owned();
            let c = Arc::clone(&collector);
            let ctx = self.ctx.clone();
            let t = task.clone();

            let handle =
                tokio::spawn(
                    async move { tokio::time::timeout(t.timeout, c.collect(&t, &ctx)).await },
                );

            match handle.await {
                Ok(Ok(CollectResult {
                    readings: r,
                    smart_reports: sr,
                    diagnostics: d,
                    sensor_capability_updates: cap_updates,
                })) => {
                    readings.extend(r);
                    smart_reports.extend(sr);
                    diagnostics.extend(d);
                    for (sid, new_cap) in cap_updates {
                        if let Some(sensor) = sensors.iter_mut().find(|s| s.sensor_id == sid) {
                            sensor.capability_status = new_cap;
                            sensor.enabled = new_cap == CapabilityStatus::Supported;
                        }
                    }
                    statuses.insert(name, collector.health_check());
                }
                Ok(Err(_elapsed)) => {
                    let msg = format!(
                        "Collector '{}' task '{}' timed out after {}ms",
                        name,
                        task.task_id,
                        task.timeout.as_millis()
                    );
                    diagnostics.push(self.failure_diag(&name, "COLLECTOR_TIMEOUT", msg.clone()));
                    statuses.insert(
                        name.clone(),
                        self.error_status(&name, "COLLECTOR_TIMEOUT", &msg),
                    );
                }
                Err(join_err) => {
                    let msg = format!(
                        "Collector '{}' panicked on task '{}': {}",
                        name, task.task_id, join_err
                    );
                    diagnostics.push(self.failure_diag(&name, "COLLECTOR_PANIC", msg.clone()));
                    statuses.insert(
                        name.clone(),
                        self.error_status(&name, "COLLECTOR_PANIC", &msg),
                    );
                }
            }
        }

        // Gather any extra collector-internal diagnostics, deduplicating by diagnostic_id.
        let mut seen_diag_ids: std::collections::BTreeSet<String> = diagnostics
            .iter()
            .map(|d| d.diagnostic_id.clone())
            .collect();
        for collector in &self.collectors {
            for diag in collector.diagnostics() {
                if seen_diag_ids.insert(diag.diagnostic_id.clone()) {
                    diagnostics.push(diag);
                }
            }
        }

        let coverage = build_coverage_report(&self.ctx.host_id, &devices, &sensors, &readings);
        Snapshot {
            devices,
            sensors,
            readings,
            smart_reports,
            collector_statuses: statuses.into_values().collect(),
            diagnostics,
            coverage,
        }
    }

    /// Low-overhead daemon tick: caches device/sensor discovery for `discovery_interval` (e.g. 60s),
    /// only executes tasks whose individual `CollectionTask.interval` has elapsed, and backs off
    /// permission-denied tasks (e.g. non-root smartctl) to 300s to minimize host CPU & I/O impact.
    pub async fn run_tick(
        &mut self,
        discovery_timeout: Duration,
        discovery_interval: Duration,
    ) -> TickSnapshot {
        let now = Instant::now();
        let mut diagnostics = Vec::new();
        let mut statuses: BTreeMap<String, CollectorStatus> = BTreeMap::new();
        self.check_wall_clock(&mut diagnostics);

        let need_discovery = self
            .last_discovery
            .map(|prev| now.duration_since(prev) >= discovery_interval)
            .unwrap_or(true);

        if need_discovery {
            let mut devices = Vec::new();
            let mut sensors = Vec::new();
            let mut tasks: Vec<(Arc<dyn Collector>, CollectionTask)> = Vec::new();

            for collector in &self.collectors {
                let name = collector.name().to_owned();
                let c = Arc::clone(collector);
                let ctx = self.ctx.clone();
                let handle = tokio::spawn(async move {
                    tokio::time::timeout(discovery_timeout, c.discover(&ctx)).await
                });
                match handle.await {
                    Ok(Ok(disc)) => {
                        devices.extend(disc.devices);
                        sensors.extend(disc.sensors);
                        diagnostics.extend(disc.diagnostics);
                        for task in disc.tasks {
                            tasks.push((Arc::clone(collector), task));
                        }
                        statuses.insert(name, collector.health_check());
                    }
                    Ok(Err(_elapsed)) => {
                        diagnostics.push(self.failure_diag(
                            &name,
                            "COLLECTOR_DISCOVERY_TIMEOUT",
                            format!("Collector '{name}' discovery timed out"),
                        ));
                        statuses.insert(
                            name.clone(),
                            self.error_status(
                                &name,
                                "COLLECTOR_DISCOVERY_TIMEOUT",
                                "discovery timed out",
                            ),
                        );
                    }
                    Err(join_err) => {
                        let msg =
                            format!("Collector '{name}' panicked during discovery: {join_err}");
                        diagnostics.push(self.failure_diag(&name, "COLLECTOR_PANIC", msg.clone()));
                        statuses.insert(
                            name.clone(),
                            self.error_status(&name, "COLLECTOR_PANIC", &msg),
                        );
                    }
                }
            }

            self.cached_devices = devices;
            self.cached_sensors = sensors;
            self.cached_tasks = tasks;
            self.last_discovery = Some(now);
        }

        let mut readings = Vec::new();
        let mut smart_reports = Vec::new();
        let mut sensor_caps_changed = false;

        let due_tasks: Vec<(Arc<dyn Collector>, CollectionTask)> = self
            .cached_tasks
            .iter()
            .filter(|(_, task)| {
                let effective_interval = self
                    .task_min_interval
                    .get(&task.task_id)
                    .copied()
                    .unwrap_or(task.interval)
                    .max(task.interval);
                self.last_task_run
                    .get(&task.task_id)
                    .map(|prev| now.duration_since(*prev) >= effective_interval)
                    .unwrap_or(true)
            })
            .map(|(c, t)| (Arc::clone(c), t.clone()))
            .collect();

        for (collector, task) in due_tasks {
            self.last_task_run.insert(task.task_id.clone(), now);
            let name = collector.name().to_owned();
            let c = Arc::clone(&collector);
            let ctx = self.ctx.clone();
            let t = task.clone();
            let handle =
                tokio::spawn(
                    async move { tokio::time::timeout(t.timeout, c.collect(&t, &ctx)).await },
                );

            match handle.await {
                Ok(Ok(CollectResult {
                    readings: r,
                    smart_reports: sr,
                    diagnostics: d,
                    sensor_capability_updates: cap_updates,
                })) => {
                    readings.extend(r);
                    smart_reports.extend(sr);
                    diagnostics.extend(d);
                    for (sid, new_cap) in cap_updates {
                        if new_cap == CapabilityStatus::PermissionDenied {
                            self.task_min_interval
                                .insert(task.task_id.clone(), Duration::from_secs(300));
                        }
                        if let Some(sensor) =
                            self.cached_sensors.iter_mut().find(|s| s.sensor_id == sid)
                            && sensor.capability_status != new_cap
                        {
                            sensor.capability_status = new_cap;
                            sensor.enabled = new_cap == CapabilityStatus::Supported;
                            sensor_caps_changed = true;
                        }
                    }
                    statuses.insert(name, collector.health_check());
                }
                Ok(Err(_elapsed)) => {
                    let msg = format!(
                        "Collector '{}' task '{}' timed out after {}ms",
                        name,
                        task.task_id,
                        task.timeout.as_millis()
                    );
                    diagnostics.push(self.failure_diag(&name, "COLLECTOR_TIMEOUT", msg.clone()));
                    statuses.insert(
                        name.clone(),
                        self.error_status(&name, "COLLECTOR_TIMEOUT", &msg),
                    );
                }
                Err(join_err) => {
                    let msg = format!(
                        "Collector '{}' panicked on task '{}': {}",
                        name, task.task_id, join_err
                    );
                    diagnostics.push(self.failure_diag(&name, "COLLECTOR_PANIC", msg.clone()));
                    statuses.insert(
                        name.clone(),
                        self.error_status(&name, "COLLECTOR_PANIC", &msg),
                    );
                }
            }
        }

        if need_discovery {
            let mut seen_diag_ids: std::collections::BTreeSet<String> = diagnostics
                .iter()
                .map(|d| d.diagnostic_id.clone())
                .collect();
            for collector in &self.collectors {
                for diag in collector.diagnostics() {
                    if seen_diag_ids.insert(diag.diagnostic_id.clone()) {
                        diagnostics.push(diag);
                    }
                }
            }
        }

        let coverage = build_coverage_report(
            &self.ctx.host_id,
            &self.cached_devices,
            &self.cached_sensors,
            &readings,
        );
        TickSnapshot {
            inventory_refreshed: need_discovery || sensor_caps_changed,
            snapshot: Snapshot {
                devices: if need_discovery || sensor_caps_changed {
                    self.cached_devices.clone()
                } else {
                    Vec::new()
                },
                sensors: if need_discovery || sensor_caps_changed {
                    self.cached_sensors.clone()
                } else {
                    Vec::new()
                },
                readings,
                smart_reports,
                collector_statuses: statuses.into_values().collect(),
                diagnostics,
                coverage,
            },
        }
    }

    pub async fn shutdown(&self) {
        for collector in &self.collectors {
            let _ = tokio::time::timeout(Duration::from_secs(3), collector.shutdown()).await;
        }
    }

    fn failure_diag(&self, collector: &str, code: &str, message: String) -> Diagnostic {
        Diagnostic {
            diagnostic_id: format!("diag-{}", Uuid::new_v4()),
            host_id: self.ctx.host_id.clone(),
            device_id: None,
            collector_name: Some(collector.to_owned()),
            level: DiagnosticLevel::Error,
            error_code: code.to_owned(),
            source: "scheduler".to_owned(),
            message,
            remediation: Some("Inspect collector diagnostics and host permissions".to_owned()),
            occurred_at: utc_now_rfc3339(),
            details: None,
        }
    }

    fn error_status(&self, collector: &str, code: &str, msg: &str) -> CollectorStatus {
        CollectorStatus {
            collector_name: collector.to_owned(),
            host_id: self.ctx.host_id.clone(),
            status: CollectorRunStatus::Error,
            capability_status: CapabilityStatus::Unknown,
            interval_seconds: 5,
            last_run_at: Some(utc_now_rfc3339()),
            last_success_at: None,
            consecutive_failures: 1,
            last_error_code: Some(code.to_owned()),
            last_error_message: Some(msg.to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collector::{BoxFuture, DiscoveryResult};
    use crate::command::MockCommandRunner;
    use crate::sysfs::MockSysFs;
    use lhm_protocol::{
        DeviceIdentity, DeviceStatus, DeviceType, ReadingQuality, SensorType, Unit,
    };

    struct PanickingCollector;
    impl Collector for PanickingCollector {
        fn name(&self) -> &'static str {
            "panicker"
        }
        fn capabilities(&self) -> CapabilityStatus {
            CapabilityStatus::Supported
        }
        fn discover<'a>(&'a self, _ctx: &'a CollectorContext) -> BoxFuture<'a, DiscoveryResult> {
            Box::pin(async { panic!("simulated collector panic") })
        }
        fn collect<'a>(
            &'a self,
            _task: &'a CollectionTask,
            _ctx: &'a CollectorContext,
        ) -> BoxFuture<'a, CollectResult> {
            Box::pin(async { CollectResult::default() })
        }
        fn health_check(&self) -> CollectorStatus {
            CollectorStatus {
                collector_name: "panicker".into(),
                host_id: "host-test".into(),
                status: CollectorRunStatus::Running,
                capability_status: CapabilityStatus::Supported,
                interval_seconds: 5,
                last_run_at: None,
                last_success_at: None,
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            }
        }
        fn diagnostics(&self) -> Vec<Diagnostic> {
            Vec::new()
        }
    }

    struct HealthyCollector;
    impl Collector for HealthyCollector {
        fn name(&self) -> &'static str {
            "healthy"
        }
        fn capabilities(&self) -> CapabilityStatus {
            CapabilityStatus::Supported
        }
        fn discover<'a>(&'a self, ctx: &'a CollectorContext) -> BoxFuture<'a, DiscoveryResult> {
            Box::pin(async move {
                DiscoveryResult {
                    devices: vec![Device {
                        device_id: "cpu-pkg-0".into(),
                        host_id: ctx.host_id.clone(),
                        device_type: DeviceType::Cpu,
                        vendor: "intel".into(),
                        model: "test".into(),
                        name: "CPU 0".into(),
                        identity: DeviceIdentity {
                            stable: true,
                            pci_bus_id: None,
                            pci_vendor_id: None,
                            pci_device_id: None,
                            wwn: None,
                            serial: None,
                            nvme_nguid: None,
                            driver: Some("coretemp".into()),
                            raw_path: None,
                            topology: None,
                        },
                        capabilities: vec!["temperature".into()],
                        device_status: DeviceStatus::Online,
                    }],
                    sensors: vec![Sensor {
                        sensor_id: "cpu-pkg-0-temp-pkg".into(),
                        device_id: "cpu-pkg-0".into(),
                        sensor_type: SensorType::Temperature,
                        sensor_name: "Package".into(),
                        source: "hwmon".into(),
                        unit: Unit::Celsius,
                        capability_status: CapabilityStatus::Supported,
                        enabled: true,
                    }],
                    tasks: vec![CollectionTask {
                        task_id: "healthy-temp".into(),
                        collector_name: "healthy".into(),
                        device_id: "cpu-pkg-0".into(),
                        group: "temp".into(),
                        interval: Duration::from_secs(3),
                        timeout: Duration::from_secs(2),
                    }],
                    diagnostics: Vec::new(),
                }
            })
        }
        fn collect<'a>(
            &'a self,
            _task: &'a CollectionTask,
            ctx: &'a CollectorContext,
        ) -> BoxFuture<'a, CollectResult> {
            Box::pin(async move {
                CollectResult {
                    readings: vec![SensorReading {
                        schema_version: "1.0".into(),
                        host_id: ctx.host_id.clone(),
                        device_id: "cpu-pkg-0".into(),
                        sensor_id: "cpu-pkg-0-temp-pkg".into(),
                        metric: "temperature".into(),
                        value: Some(45.0),
                        unit: Unit::Celsius,
                        quality: ReadingQuality::Valid,
                        source: "hwmon".into(),
                        collected_at: utc_now_rfc3339(),
                    }],
                    smart_reports: Vec::new(),
                    diagnostics: Vec::new(),
                    sensor_capability_updates: Vec::new(),
                }
            })
        }
        fn health_check(&self) -> CollectorStatus {
            CollectorStatus {
                collector_name: "healthy".into(),
                host_id: "host-test".into(),
                status: CollectorRunStatus::Running,
                capability_status: CapabilityStatus::Supported,
                interval_seconds: 3,
                last_run_at: Some(utc_now_rfc3339()),
                last_success_at: Some(utc_now_rfc3339()),
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            }
        }
        fn diagnostics(&self) -> Vec<Diagnostic> {
            Vec::new()
        }
    }

    #[tokio::test]
    async fn single_collector_panic_does_not_abort_other_collectors() {
        let ctx = CollectorContext {
            host_id: "host-test".into(),
            sysfs: Arc::new(MockSysFs::new()),
            cmd: Arc::new(MockCommandRunner::new()),
        };
        let mut runner = AgentRunner::new(
            vec![Arc::new(PanickingCollector), Arc::new(HealthyCollector)],
            ctx,
        );
        let snap = runner.run_once(Duration::from_secs(2)).await;
        assert_eq!(snap.readings.len(), 1);
        assert_eq!(snap.readings[0].value, Some(45.0));
        assert!(
            snap.diagnostics
                .iter()
                .any(|d| d.error_code == "COLLECTOR_PANIC")
        );
        assert!(snap.coverage.devices[0].temperature_read_ok);
    }

    #[tokio::test]
    async fn tiered_tick_caches_discovery_and_respects_task_intervals() {
        let ctx = CollectorContext {
            host_id: "host-test".into(),
            sysfs: Arc::new(MockSysFs::new()),
            cmd: Arc::new(MockCommandRunner::new()),
        };
        let mut runner = AgentRunner::new(vec![Arc::new(HealthyCollector)], ctx);

        // First tick discovers devices/sensors and executes due 3s task
        let t1 = runner
            .run_tick(Duration::from_secs(2), Duration::from_secs(60))
            .await;
        assert!(t1.inventory_refreshed);
        assert_eq!(t1.snapshot.devices.len(), 1);
        assert_eq!(t1.snapshot.readings.len(), 1);

        // Immediate second tick skips discovery (60s cache) and skips 3s task
        let t2 = runner
            .run_tick(Duration::from_secs(2), Duration::from_secs(60))
            .await;
        assert!(!t2.inventory_refreshed);
        assert!(t2.snapshot.devices.is_empty());
        assert!(t2.snapshot.readings.is_empty());
    }
}
