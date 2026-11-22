pub mod cpu;
pub mod gpu;
pub mod hwmon;
pub mod memory;
pub mod network;
pub mod nvme;
pub mod smart;
pub mod storage;
pub mod thermal;

use agent_core::collector::Collector;
use std::sync::Arc;

/// Returns the default set of hardware collectors in discovery order.
pub fn default_collectors(host_id: &str) -> Vec<Arc<dyn Collector>> {
    vec![
        Arc::new(cpu::CpuCollector::new(host_id)),
        Arc::new(gpu::GpuCollector::new(host_id)),
        Arc::new(hwmon::HwmonCollector::new(host_id)),
        Arc::new(thermal::ThermalCollector::new(host_id)),
        Arc::new(memory::MemoryCollector::new(host_id)),
        Arc::new(storage::StorageCollector::new(host_id)),
        Arc::new(smart::SmartCollector::new(host_id)),
        Arc::new(nvme::NvmeCollector::new(host_id)),
        Arc::new(network::NetworkCollector::new(host_id)),
    ]
}
