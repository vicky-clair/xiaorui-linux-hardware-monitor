use crate::command::CommandRunner;
use crate::sysfs::SysFs;
use lhm_protocol::{
    CapabilityStatus, CollectorStatus, Device, Diagnostic, Sensor, SensorReading, SmartReport,
};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Granular scheduled collection task (e.g., SMART temp 30s vs SMART full 15m).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectionTask {
    pub task_id: String,
    pub collector_name: String,
    pub device_id: String,
    pub group: String,
    pub interval: Duration,
    pub timeout: Duration,
}

#[derive(Debug, Default, Clone)]
pub struct DiscoveryResult {
    pub devices: Vec<Device>,
    pub sensors: Vec<Sensor>,
    pub tasks: Vec<CollectionTask>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Default, Clone)]
pub struct CollectResult {
    pub readings: Vec<SensorReading>,
    pub smart_reports: Vec<SmartReport>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone)]
pub struct CollectorContext {
    pub host_id: String,
    pub sysfs: Arc<dyn SysFs>,
    pub cmd: Arc<dyn CommandRunner>,
}

/// Unified collector lifecycle interface (ADR-0008).
pub trait Collector: Send + Sync {
    fn name(&self) -> &'static str;
    fn capabilities(&self) -> CapabilityStatus;
    fn discover<'a>(&'a self, ctx: &'a CollectorContext) -> BoxFuture<'a, DiscoveryResult>;
    fn collect<'a>(
        &'a self,
        task: &'a CollectionTask,
        ctx: &'a CollectorContext,
    ) -> BoxFuture<'a, CollectResult>;
    fn health_check(&self) -> CollectorStatus;
    fn diagnostics(&self) -> Vec<Diagnostic>;
    fn shutdown<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
}
