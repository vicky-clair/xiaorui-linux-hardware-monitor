import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  CapabilityStatus,
  DeviceStatus,
  ReadingQuality,
} from "@lhm/protocol/types";
import type { DiagnosticRow } from "./api.ts";

export type Locale = "zh" | "en" | "ja";

export const LOCALE_OPTIONS: Array<{ value: Locale; label: string; bcp47: string }> = [
  { value: "zh", label: "中文", bcp47: "zh-CN" },
  { value: "en", label: "English", bcp47: "en-US" },
  { value: "ja", label: "日本語", bcp47: "ja-JP" },
];

const STORAGE_KEY = "lhm_locale";

export function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en" || saved === "ja") return saved;
  } catch {
    // ignore storage access failure
  }
  return "zh";
}

export function localeToBcp47(locale: Locale): string {
  return LOCALE_OPTIONS.find((o) => o.value === locale)?.bcp47 ?? "zh-CN";
}

type Dict = Record<string, string>;

const DICTIONARIES: Record<Locale, Dict> = {
  zh: {
    // Navigation & Shell
    "nav.overview": "系统总览",
    "nav.cpu": "CPU 监控",
    "nav.gpu": "GPU 监控",
    "nav.motherboard": "主板传感器",
    "nav.memory": "内存监控",
    "nav.storage": "存储健康 / SMART",
    "nav.nvme": "NVMe 监控",
    "nav.temp-history": "温度历史",
    "nav.fans-voltage": "风扇与电压",
    "nav.alerts": "告警中心",
    "nav.analysis": "健康评分与分析",
    "nav.devices": "硬件设备列表",
    "nav.coverage": "传感器覆盖率",
    "nav.diagnostics": "采集器诊断",
    "nav.config": "系统配置",
    "shell.checkingAuth": "正在检查登录状态...",
    "shell.lastPush": "最近推送：",
    "shell.logout": "退出登录",
    "shell.language": "语言",
    "shell.globalAlertCritical": "硬件告警触发中：",
    "shell.globalAlertWarning": "检测到硬件健康警告：",
    "shell.globalAlertFiringCount": "条触发中告警",
    "shell.globalAlertCritDevCount": "台严重异常设备",
    "shell.globalAlertWarnDevCount": "台警告设备",
    "shell.viewAlerts": "查看告警中心",
    "shell.viewAnalysis": "查看健康分析",
    // Empty descriptions per category
    "empty.cpu": "未发现 CPU 传感器。",
    "empty.gpu": "当前主机未发现 GPU 设备或 DRM 接口。",
    "empty.motherboard": "未发现主板 hwmon 或 thermal 传感器。",
    "empty.memory": "未发现内存监控数据。",
    "empty.fansVoltage":
      "当前主机未暴露风扇转速、电压或功耗传感器（部分平台无 Super I/O 或电源遥测）。",
    // Common States
    "state.loading": "正在加载数据...",
    "state.emptyTitle": "暂无数据",
    "state.emptyDesc": "当前主机未上报该类别数据或尚无历史采样。",
    "state.requestFailed": "请求失败",
    "state.retry": "重试",
    "state.permissionDenied": "权限不足：",
    "state.suggestion": "建议：",
    "ws.connected": "实时推送已连接",
    "ws.connecting": "实时推送连接中...",
    "ws.disconnected": "实时推送已断开（数据可能不是最新）",
    // Badges & Formatting
    "fmt.noData": "— (无数据)",
    "fmt.sensorFault": "— (传感器故障)",
    "fmt.day": "天",
    "fmt.hour": "小时",
    "fmt.min": "分",
    "cap.supported": "支持",
    "cap.unsupported": "硬件不支持",
    "cap.permission_denied": "权限不足",
    "cap.unavailable": "暂不可用",
    "cap.unknown": "未知",
    "devStatus.online": "在线",
    "devStatus.standby": "待机（未唤醒）",
    "devStatus.offline": "离线",
    "devStatus.unknown": "未知",
    "quality.valid": "有效",
    "quality.stale": "数据过期",
    "quality.sensor_fault": "传感器故障",
    "quality.out_of_range": "超出范围",
    "quality.missing": "无数据",
    "sev.normal": "正常",
    "sev.warning": "警告",
    "sev.critical": "严重",
    "sev.unknown": "未知 / 数据不足",
    // Login
    "login.descLogin": "请使用已配置账户登录硬件监控控制台。",
    "login.descBootstrap": "首次启动请使用 API 日志输出的一次性引导令牌创建管理员账户。",
    "login.tabLogin": "账户登录",
    "login.tabBootstrap": "初始化管理员",
    "login.bootstrapToken": "一次性引导令牌（Bootstrap Token）",
    "login.bootstrapPlaceholder": "来自 lhm-api 启动日志",
    "login.username": "用户名",
    "login.password": "密码（至少 10 位）",
    "login.submitting": "提交中...",
    "login.submitLogin": "登录",
    "login.submitBootstrap": "创建管理员并登录",
    // Overview
    "overview.loading": "正在加载系统总览...",
    "overview.notice":
      "前端仅展示 API 返回的硬件遥测与 Haskell 引擎分析结果，绝不在前端推断健康状态或补零。",
    "overview.host": "监控主机",
    "overview.waitAgent": "等待 Agent 上报",
    "overview.devices": "已发现设备",
    "overview.sensorCount": "传感器总数：",
    "overview.permDeniedDevices": "权限受限设备",
    "overview.staleDevices": "数据过期设备：",
    "overview.uptime": "主机运行时间",
    "overview.lastHeartbeat": "最近心跳：",
    "overview.collectorsTitle": "采集器运行状态",
    "overview.noCollectors": "尚无采集器状态",
    "overview.noCollectorsDesc": "等待 Rust Agent 上报 collector_status。",
    "overview.recentDiagnostics": "最近诊断记录",
    "overview.noDiagnostics": "暂无诊断事件。",
    "overview.globalCheckBtn": "立即全局健康检测",
    "overview.globalChecking": "正在唤醒硬件采集并运行健康分析...",
    "overview.globalCheckHint": "12 小时超低功耗模式运行中；点击右侧按钮可随时按需执行一次完整硬件采样与健康评估。",
    "overview.checkDonePrefix": "全局检测已完成（",
    "overview.checkAgentOk": "已实时采集宿主机硬件",
    "overview.checkAgentSkip": "未连接 Agent 控制口，基于最新库数据评估",
    "overview.checkSummary": "设备评估：",
    // Table headers
    "th.collector": "采集器",
    "th.runStatus": "运行状态",
    "th.capability": "能力状态",
    "th.interval": "周期",
    "th.collectInterval": "采集周期",
    "th.failures": "连续失败",
    "th.lastSuccess": "最近成功时间",
    "th.lastError": "最近错误",
    "th.time": "时间",
    "th.level": "级别",
    "th.errorCode": "错误代码",
    "th.device": "设备",
    "th.deviceStatus": "设备状态",
    "th.detailsAndRemediation": "详情与建议",
    "th.diagAndRemediation": "诊断说明与修复建议",
    "th.collectorDevice": "采集器 / 设备",
    "th.sensor": "传感器",
    "th.source": "来源",
    "th.currentValue": "当前值",
    "th.quality": "数据质量",
    "th.collectedAt": "采样时间",
    "th.protocol": "协议",
    "th.smartSelfTest": "SMART 自检",
    "th.temperature": "温度",
    "th.powerOnHours": "通电小时",
    "th.dataUnitsRead": "读取数据单元 (128-bit)",
    "th.dataUnitsWritten": "写入数据单元 (128-bit)",
    "th.action": "操作",
    "th.attrName": "属性名",
    "th.rawValue": "Raw Value (精确字符串)",
    "th.stableDeviceId": "稳定设备 ID",
    "th.type": "类型",
    "th.nameModel": "名称 / 型号",
    "th.vendor": "厂商",
    "th.status": "状态",
    "th.lastSeen": "最近发现",
    "th.sensorId": "传感器 ID",
    "th.name": "名称",
    "th.unit": "单位",
    "th.tempCap": "温度能力",
    "th.supportedMetrics": "已支持指标",
    "th.permDenied": "权限不足",
    "th.unsupported": "硬件不支持",
    "th.stale": "数据过期 (stale)",
    "th.lastSuccessSample": "最近成功采样",
    "th.severity": "级别",
    "th.deviceRule": "设备 / 规则",
    "th.summary": "摘要",
    "th.triggeredAt": "触发时间",
    "th.ackInfo": "确认信息",
    "th.ruleId": "规则 ID",
    "th.deviceType": "设备类型",
    "th.metricCond": "指标与条件",
    "th.duration": "持续时间",
    "th.deviceId": "设备 ID",
    "th.severityLevel": "严重级别",
    "th.score": "可解释评分",
    "th.trend": "趋势",
    "th.thresholdSource": "阈值来源",
    "th.evidence": "评分依据（因素 / 异常 / 关联）",
    "th.versionTime": "版本与时间",
    // Sensor Category
    "sensorCat.loadingPrefix": "正在加载 ",
    "sensorCat.emptySuffix": "暂无传感器",
    "sensorCat.deniedSubjectPrefix": "以下指标因权限不足无法读取：",
    "sensorCat.deniedRemediation":
      "请查看「采集器诊断」页面获取最小权限配置建议，不要将权限不足视为硬件故障。",
    // Storage
    "storage.loading": "正在加载存储与 SMART 信息...",
    "storage.titleAll": "存储健康与 SMART",
    "storage.titleNvme": "NVMe 监控",
    "storage.emptySuffix": "：未发现设备",
    "storage.emptyDesc": "当前主机未发现该类型的存储设备。",
    "storage.standbySkip": "待机跳过（未唤醒）",
    "storage.passed": "通过",
    "storage.failed": "未通过",
    "storage.smartDetailBtn": "SMART 详情",
    "storage.rawAttrTitle": "SMART 原始属性：",
    "storage.noSmartReport":
      "尚未收到该设备的 SMART 报告（若非 root 运行，请检查采集器诊断中的 SMART_PERMISSION_DENIED）。",
    "storage.noAtaTable": "无 ATA 属性表。",
    "storage.lastCollectPrefix": "最近采集时间：",
    "storage.currentStatusPrefix": "；当前状态：",
    // Temperature History
    "history.loading": "正在加载温度传感器列表...",
    "history.noSensors": "无可用温度传感器",
    "history.noSensorsDesc": "当前主机没有状态为 supported 的温度传感器。",
    "history.title": "温度历史曲线",
    "history.exportCsv": "导出 CSV",
    "history.exportJson": "导出 JSON",
    "history.rangeAria": "时间范围",
    "history.range15m": "最近 15 分钟 (原始)",
    "history.range1h": "最近 1 小时 (原始)",
    "history.range6h": "最近 6 小时 (1分钟聚合)",
    "history.range24h": "最近 24 小时 (1分钟聚合)",
    "history.range7d": "最近 7 天 (1小时聚合)",
    "history.noPoints": "所选时间范围内无采样点",
    "history.noPointsDesc": "请切换时间范围或等待 Agent 持续上报。",
    // Devices
    "devices.loading": "正在加载硬件设备列表...",
    "devices.empty": "暂无已发现设备",
    "devices.title": "硬件设备列表",
    "devices.inspectBtn": "身份详情",
    "devices.identityTitle": "设备身份与拓扑：",
    // Coverage
    "coverage.loading": "正在加载传感器覆盖率...",
    "coverage.empty": "暂无传感器覆盖率记录",
    "coverage.titlePrefix": "传感器覆盖率",
    "coverage.devicesUnit": "台设备",
    "coverage.sensorsUnit": "个传感器",
    "coverage.staleThreshold": "过期阈值",
    "coverage.tempOk": "支持且已读",
    "coverage.tempNoRead": "支持（未读到）",
    "coverage.tempNone": "无",
    // Diagnostics
    "diag.loading": "正在加载采集器状态与诊断日志...",
    "diag.collectorsTitle": "采集器健康与运行状态",
    "diag.noCollectors": "暂无采集器上报",
    "diag.eventsTitle": "结构化诊断事件与日志",
    "diag.noEvents": "暂无诊断记录",
    "diag.noEventsDesc": "当前未记录任何权限不足、超时或采集异常。",
    "diag.remediationPrefix": "修复建议：",
    // Alerts
    "alerts.loading": "正在加载告警与规则...",
    "alerts.title": "告警中心",
    "alerts.empty": "当前无告警记录",
    "alerts.emptyDesc": "Haskell 引擎触发告警后将在此展示。",
    "alerts.unacked": "未确认",
    "alerts.ackBtn": "确认告警",
    "alerts.rulesTitle": "告警规则管理",
    "alerts.viewerDenied": "当前账户为只读角色（viewer），无法新增或删除告警规则。",
    "alerts.viewerRemediation": "请使用管理员（admin）账户维护告警阈值规则。",
    "alerts.warningPrefix": "阈值安全提示：",
    "alerts.ruleIdPlaceholder": "规则 ID",
    "alerts.thresholdPlaceholder": "温度阈值 °C",
    "alerts.durationPlaceholder": "持续秒数",
    "alerts.addRuleBtn": "新增告警规则",
    "alerts.presetBtn": "一键应用推荐安全规则",
    "alerts.presetDone": "已应用推荐安全告警规则（CPU / 硬盘 / GPU / 主板），已存在的规则自动保留。",
    "alerts.noRules": "暂未配置自定义告警规则（点击上方「一键应用推荐安全规则」即可立即启用告警）。",
    "alerts.deleteBtn": "删除",
    "alertStatus.firing": "触发中",
    "alertStatus.resolved": "已恢复",
    "alertStatus.pending": "等待确认",
    "alertStatus.ok": "正常",
    // Analysis
    "analysis.loading": "正在加载健康分析结果...",
    "analysis.title": "健康评分与分析（Haskell 引擎计算）",
    "analysis.running": "分析中...",
    "analysis.runNow": "立即运行分析",
    "analysis.empty": "尚无健康分析结果",
    "analysis.emptyDesc": "请确保 Haskell 健康引擎运行，或点击「立即运行分析」触发一次评估。",
    "analysis.unscorable": "— (无法评分)",
    "analysis.anomalyPrefix": "异常",
    "analysis.correlationPrefix": "关联",
    // Config
    "config.loading": "正在加载系统配置...",
    "config.title": "系统配置",
    "config.viewerDenied": "当前账户为只读角色（viewer），无法修改系统配置。",
    "config.viewerRemediation": "如需调整数据保留策略或过期阈值，请使用管理员（admin）账户登录。",
    "config.savedNotice": "配置已保存并记录审计日志。",
    "config.staleLabel": "数据过期判定阈值（秒）",
    "config.rawDaysLabel": "原始采样保留天数（默认 14 天）",
    "config.defaultsNote1": "默认聚合保留：1 分钟聚合",
    "config.defaultsNote2": "天 · 1 小时聚合",
    "config.defaultsNote3": "天 · SMART 历史",
    "config.defaultsNote4": "天（敏感配置项不会下发至前端）。",
    "config.saving": "保存中...",
    "config.saveBtn": "保存配置（写审计日志）",
    "config.langTitle": "界面与日志显示语言",
    "config.langDesc": "实时切换全部界面文字、采集器状态、诊断日志、修复建议与健康分析说明的显示语言。",
    "config.exportTitle": "数据导出",
    "config.exportReportBtn": "导出脱敏健康与诊断报告 (JSON)",
    "config.exportReportDesc":
      "导出报告包含主机、设备、覆盖率、最新健康分析、告警与诊断日志，自动剔除用户凭据与敏感配置。",
    "config.webhookTitle": "告警通知（Webhook）",
    "config.webhookSaved": "告警 Webhook 通知配置已保存（密钥已脱敏保存）。",
    "config.webhookTestOk": "测试通知发送成功",
    "config.webhookTestFail": "测试通知发送失败：",
    "config.webhookEnable": "启用告警状态变更 Webhook 推送",
    "config.webhookUrl": "Webhook URL（仅允许 http/https，已禁止云元数据 SSRF 地址）",
    "config.webhookSecret": "HMAC-SHA256 签名密钥（可选，当前状态：",
    "config.secretConfigured": "已配置",
    "config.secretNotConfigured": "未配置",
    "config.secretPlaceholder": "留空保持不变",
    "config.saveNotifBtn": "保存通知配置",
    "config.testNotifBtn": "发送测试通知",
  },
  en: {
    "nav.overview": "Overview",
    "nav.cpu": "CPU Monitor",
    "nav.gpu": "GPU Monitor",
    "nav.motherboard": "Motherboard",
    "nav.memory": "Memory",
    "nav.storage": "Storage / SMART",
    "nav.nvme": "NVMe Monitor",
    "nav.temp-history": "Temp History",
    "nav.fans-voltage": "Fans & Voltage",
    "nav.alerts": "Alerts",
    "nav.analysis": "Health Analysis",
    "nav.devices": "Devices",
    "nav.coverage": "Sensor Coverage",
    "nav.diagnostics": "Diagnostics & Logs",
    "nav.config": "Settings",
    "shell.checkingAuth": "Checking authentication...",
    "shell.lastPush": "Last push: ",
    "shell.logout": "Sign Out",
    "shell.language": "Language",
    "shell.globalAlertCritical": "Active Hardware Alert: ",
    "shell.globalAlertWarning": "Hardware Health Warning: ",
    "shell.globalAlertFiringCount": "firing alert(s)",
    "shell.globalAlertCritDevCount": "critical device(s)",
    "shell.globalAlertWarnDevCount": "warning device(s)",
    "shell.viewAlerts": "Open Alerts",
    "shell.viewAnalysis": "Open Health Analysis",
    "empty.cpu": "No CPU sensors discovered.",
    "empty.gpu": "No GPU devices or DRM interfaces discovered on this host.",
    "empty.motherboard": "No motherboard hwmon or thermal sensors discovered.",
    "empty.memory": "No memory telemetry discovered.",
    "empty.fansVoltage":
      "No fan speed, voltage, or power sensors exposed on this host (platform may lack Super I/O telemetry).",
    "state.loading": "Loading data...",
    "state.emptyTitle": "No Data",
    "state.emptyDesc": "No telemetry or historical samples reported for this category yet.",
    "state.requestFailed": "Request Failed",
    "state.retry": "Retry",
    "state.permissionDenied": "Permission Denied: ",
    "state.suggestion": "Recommendation: ",
    "ws.connected": "Live Stream Connected",
    "ws.connecting": "Connecting Live Stream...",
    "ws.disconnected": "Live Stream Disconnected (data may be stale)",
    "fmt.noData": "— (No Data)",
    "fmt.sensorFault": "— (Sensor Fault)",
    "fmt.day": "d",
    "fmt.hour": "h",
    "fmt.min": "m",
    "cap.supported": "Supported",
    "cap.unsupported": "Unsupported",
    "cap.permission_denied": "Permission Denied",
    "cap.unavailable": "Unavailable",
    "cap.unknown": "Unknown",
    "devStatus.online": "Online",
    "devStatus.standby": "Standby (Not Woken)",
    "devStatus.offline": "Offline",
    "devStatus.unknown": "Unknown",
    "quality.valid": "Valid",
    "quality.stale": "Stale",
    "quality.sensor_fault": "Sensor Fault",
    "quality.out_of_range": "Out of Range",
    "quality.missing": "Missing",
    "sev.normal": "Normal",
    "sev.warning": "Warning",
    "sev.critical": "Critical",
    "sev.unknown": "Unknown / Insufficient Data",
    "login.descLogin": "Sign in to the Linux Hardware Monitor console.",
    "login.descBootstrap":
      "For first-time setup, enter the one-time bootstrap token from lhm-api logs to create the initial admin user.",
    "login.tabLogin": "Sign In",
    "login.tabBootstrap": "Bootstrap Admin",
    "login.bootstrapToken": "One-Time Bootstrap Token",
    "login.bootstrapPlaceholder": "From lhm-api startup logs",
    "login.username": "Username",
    "login.password": "Password (min 10 chars)",
    "login.submitting": "Submitting...",
    "login.submitLogin": "Sign In",
    "login.submitBootstrap": "Create Admin & Sign In",
    "overview.loading": "Loading system overview...",
    "overview.notice":
      "The frontend only displays API telemetry and Haskell engine results; it never infers health or substitutes missing data with 0.",
    "overview.host": "Monitored Host",
    "overview.waitAgent": "Waiting for Agent telemetry",
    "overview.devices": "Discovered Devices",
    "overview.sensorCount": "Total sensors: ",
    "overview.permDeniedDevices": "Permission-Limited Devices",
    "overview.staleDevices": "Stale devices: ",
    "overview.uptime": "Host Uptime",
    "overview.lastHeartbeat": "Last heartbeat: ",
    "overview.collectorsTitle": "Collector Status",
    "overview.noCollectors": "No Collector Status",
    "overview.noCollectorsDesc": "Waiting for Rust Agent to report collector_status.",
    "overview.recentDiagnostics": "Recent Diagnostics & Logs",
    "overview.noDiagnostics": "No diagnostic events recorded.",
    "overview.globalCheckBtn": "Run Global Health Check",
    "overview.globalChecking": "Collecting live hardware telemetry & running health analysis...",
    "overview.globalCheckHint": "Ultra-low-power 12h mode active; click the button to trigger an immediate full hardware scan & health check anytime.",
    "overview.checkDonePrefix": "Global health check completed (",
    "overview.checkAgentOk": "live host hardware collected",
    "overview.checkAgentSkip": "agent control socket unavailable; analyzed latest stored readings",
    "overview.checkSummary": "Evaluated: ",
    "th.collector": "Collector",
    "th.runStatus": "Status",
    "th.capability": "Capability",
    "th.interval": "Interval",
    "th.collectInterval": "Interval",
    "th.failures": "Failures",
    "th.lastSuccess": "Last Success",
    "th.lastError": "Last Error",
    "th.time": "Time",
    "th.level": "Level",
    "th.errorCode": "Error Code",
    "th.device": "Device",
    "th.deviceStatus": "Device Status",
    "th.detailsAndRemediation": "Details & Remediation",
    "th.diagAndRemediation": "Diagnostic Details & Remediation",
    "th.collectorDevice": "Collector / Device",
    "th.sensor": "Sensor",
    "th.source": "Source",
    "th.currentValue": "Current Value",
    "th.quality": "Quality",
    "th.collectedAt": "Collected At",
    "th.protocol": "Protocol",
    "th.smartSelfTest": "SMART Status",
    "th.temperature": "Temp",
    "th.powerOnHours": "Power-On Hours",
    "th.dataUnitsRead": "Data Units Read (128-bit)",
    "th.dataUnitsWritten": "Data Units Written (128-bit)",
    "th.action": "Action",
    "th.attrName": "Attribute",
    "th.rawValue": "Raw Value (Exact String)",
    "th.stableDeviceId": "Stable Device ID",
    "th.type": "Type",
    "th.nameModel": "Name / Model",
    "th.vendor": "Vendor",
    "th.status": "Status",
    "th.lastSeen": "Last Seen",
    "th.sensorId": "Sensor ID",
    "th.name": "Name",
    "th.unit": "Unit",
    "th.tempCap": "Temp Capability",
    "th.supportedMetrics": "Supported",
    "th.permDenied": "Permission Denied",
    "th.unsupported": "Unsupported",
    "th.stale": "Stale",
    "th.lastSuccessSample": "Last Valid Sample",
    "th.severity": "Severity",
    "th.deviceRule": "Device / Rule",
    "th.summary": "Summary",
    "th.triggeredAt": "Triggered At",
    "th.ackInfo": "Acknowledged",
    "th.ruleId": "Rule ID",
    "th.deviceType": "Device Type",
    "th.metricCond": "Condition",
    "th.duration": "Duration",
    "th.deviceId": "Device ID",
    "th.severityLevel": "Severity",
    "th.score": "Explainable Score",
    "th.trend": "Trend",
    "th.thresholdSource": "Threshold Source",
    "th.evidence": "Evidence (Factors / Anomalies / Correlations)",
    "th.versionTime": "Version & Time",
    "sensorCat.loadingPrefix": "Loading ",
    "sensorCat.emptySuffix": ": No Sensors",
    "sensorCat.deniedSubjectPrefix": "Metrics unavailable due to insufficient permissions: ",
    "sensorCat.deniedRemediation":
      "Check the Diagnostics page for minimal-privilege configuration advice; never treat permission errors as hardware faults.",
    "storage.loading": "Loading storage & SMART data...",
    "storage.titleAll": "Storage Health & SMART",
    "storage.titleNvme": "NVMe Monitor",
    "storage.emptySuffix": ": No Devices Found",
    "storage.emptyDesc": "No storage devices of this type were discovered on the host.",
    "storage.standbySkip": "Skipped (Standby, Not Woken)",
    "storage.passed": "PASSED",
    "storage.failed": "FAILED",
    "storage.smartDetailBtn": "SMART Details",
    "storage.rawAttrTitle": "SMART Raw Attributes: ",
    "storage.noSmartReport":
      "No SMART report received for this device yet (if running non-root, check SMART_PERMISSION_DENIED in Diagnostics).",
    "storage.noAtaTable": "No ATA attribute table available.",
    "storage.lastCollectPrefix": "Last collected: ",
    "storage.currentStatusPrefix": "; Status: ",
    "history.loading": "Loading temperature sensors...",
    "history.noSensors": "No Temperature Sensors Available",
    "history.noSensorsDesc": "No supported temperature sensors were found on this host.",
    "history.title": "Temperature History",
    "history.exportCsv": "Export CSV",
    "history.exportJson": "Export JSON",
    "history.rangeAria": "Time Range",
    "history.range15m": "Last 15 min (raw)",
    "history.range1h": "Last 1 hour (raw)",
    "history.range6h": "Last 6 hours (1m avg)",
    "history.range24h": "Last 24 hours (1m avg)",
    "history.range7d": "Last 7 days (1h avg)",
    "history.noPoints": "No Samples in Selected Range",
    "history.noPointsDesc": "Try another time range or wait for Agent telemetry.",
    "devices.loading": "Loading hardware devices...",
    "devices.empty": "No Devices Discovered",
    "devices.title": "Hardware Devices",
    "devices.inspectBtn": "Identity",
    "devices.identityTitle": "Device Identity & Topology: ",
    "coverage.loading": "Loading sensor coverage...",
    "coverage.empty": "No Coverage Records",
    "coverage.titlePrefix": "Sensor Coverage",
    "coverage.devicesUnit": "devices",
    "coverage.sensorsUnit": "sensors",
    "coverage.staleThreshold": "stale after",
    "coverage.tempOk": "Supported & Active",
    "coverage.tempNoRead": "Supported (No Reading)",
    "coverage.tempNone": "None",
    "diag.loading": "Loading collector status & diagnostic logs...",
    "diag.collectorsTitle": "Collector Health & Status",
    "diag.noCollectors": "No Collectors Reported",
    "diag.eventsTitle": "Structured Diagnostic Events & Logs",
    "diag.noEvents": "No Diagnostic Records",
    "diag.noEventsDesc": "No permission issues, timeouts, or collector errors recorded.",
    "diag.remediationPrefix": "Remediation: ",
    "alerts.loading": "Loading alerts & rules...",
    "alerts.title": "Alert Center",
    "alerts.empty": "No Alerts",
    "alerts.emptyDesc": "Alerts generated by the Haskell health engine will appear here.",
    "alerts.unacked": "Unacknowledged",
    "alerts.ackBtn": "Acknowledge",
    "alerts.rulesTitle": "Alert Rules",
    "alerts.viewerDenied": "Read-only role (viewer) cannot create or delete alert rules.",
    "alerts.viewerRemediation": "Sign in with an administrator (admin) account to manage alert rules.",
    "alerts.warningPrefix": "Safety Notice: ",
    "alerts.ruleIdPlaceholder": "Rule ID",
    "alerts.thresholdPlaceholder": "Threshold °C",
    "alerts.durationPlaceholder": "Duration (s)",
    "alerts.addRuleBtn": "Add Alert Rule",
    "alerts.presetBtn": "Apply Recommended Safe Rules",
    "alerts.presetDone": "Recommended safe rules applied (CPU / Storage / GPU / Motherboard); existing rules were preserved.",
    "alerts.noRules": "No custom alert rules configured (click 'Apply Recommended Safe Rules' above to enable alerting immediately).",
    "alerts.deleteBtn": "Delete",
    "alertStatus.firing": "Firing",
    "alertStatus.resolved": "Resolved",
    "alertStatus.pending": "Pending",
    "alertStatus.ok": "OK",
    "analysis.loading": "Loading health analysis...",
    "analysis.title": "Health Score & Analysis (Haskell Engine)",
    "analysis.running": "Analyzing...",
    "analysis.runNow": "Run Analysis Now",
    "analysis.empty": "No Analysis Results Yet",
    "analysis.emptyDesc": "Ensure the Haskell health engine is running or click 'Run Analysis Now'.",
    "analysis.unscorable": "— (Not Scorable)",
    "analysis.anomalyPrefix": "Anomaly",
    "analysis.correlationPrefix": "Correlation",
    "config.loading": "Loading system settings...",
    "config.title": "System Settings",
    "config.viewerDenied": "Read-only role (viewer) cannot modify system settings.",
    "config.viewerRemediation": "Sign in as administrator (admin) to update retention or staleness settings.",
    "config.savedNotice": "Settings saved and recorded in audit log.",
    "config.staleLabel": "Stale Data Threshold (seconds)",
    "config.rawDaysLabel": "Raw Reading Retention (days, default 14)",
    "config.defaultsNote1": "Default aggregate retention: 1m",
    "config.defaultsNote2": "d · 1h",
    "config.defaultsNote3": "d · SMART history",
    "config.defaultsNote4": "d (sensitive settings are never sent to the frontend).",
    "config.saving": "Saving...",
    "config.saveBtn": "Save Settings (Audit Logged)",
    "config.langTitle": "UI & Log Display Language",
    "config.langDesc":
      "Instantly switches all UI labels, collector statuses, diagnostic logs, remediations, and health analysis descriptions.",
    "config.exportTitle": "Data Export",
    "config.exportReportBtn": "Export Sanitized Health & Diagnostic Report (JSON)",
    "config.exportReportDesc":
      "Includes host, devices, coverage, latest health analysis, alerts, and diagnostic logs; automatically strips user credentials and secrets.",
    "config.webhookTitle": "Alert Notifications (Webhook)",
    "config.webhookSaved": "Webhook notification settings saved (secret stored securely).",
    "config.webhookTestOk": "Test webhook delivered successfully",
    "config.webhookTestFail": "Test webhook delivery failed: ",
    "config.webhookEnable": "Enable Webhook notifications on alert transitions",
    "config.webhookUrl": "Webhook URL (http/https only; cloud metadata SSRF blocked)",
    "config.webhookSecret": "HMAC-SHA256 Signing Secret (optional, status: ",
    "config.secretConfigured": "Configured",
    "config.secretNotConfigured": "Not Set",
    "config.secretPlaceholder": "Leave blank to keep unchanged",
    "config.saveNotifBtn": "Save Notification Settings",
    "config.testNotifBtn": "Send Test Webhook",
  },
  ja: {
    "nav.overview": "システム概要",
    "nav.cpu": "CPU 監視",
    "nav.gpu": "GPU 監視",
    "nav.motherboard": "マザーボード",
    "nav.memory": "メモリ監視",
    "nav.storage": "ストレージ / SMART",
    "nav.nvme": "NVMe 監視",
    "nav.temp-history": "温度履歴",
    "nav.fans-voltage": "ファン・電圧",
    "nav.alerts": "アラート管理",
    "nav.analysis": "健全性スコア・分析",
    "nav.devices": "ハードウェア一覧",
    "nav.coverage": "センサー網羅率",
    "nav.diagnostics": "診断・ログ",
    "nav.config": "システム設定",
    "shell.checkingAuth": "認証状態を確認しています...",
    "shell.lastPush": "最終受信：",
    "shell.logout": "ログアウト",
    "shell.language": "言語",
    "shell.globalAlertCritical": "ハードウェアアラート発報中：",
    "shell.globalAlertWarning": "ハードウェア健全性警告：",
    "shell.globalAlertFiringCount": "件の発報中アラート",
    "shell.globalAlertCritDevCount": "台の重大異常デバイス",
    "shell.globalAlertWarnDevCount": "台の警告デバイス",
    "shell.viewAlerts": "アラート管理を開く",
    "shell.viewAnalysis": "健全性分析を開く",
    "empty.cpu": "CPU センサーが見つかりません。",
    "empty.gpu": "このホストでは GPU デバイスまたは DRM インターフェースが見つかりません。",
    "empty.motherboard": "マザーボードの hwmon / thermal センサーが見つかりません。",
    "empty.memory": "メモリ監視データが見つかりません。",
    "empty.fansVoltage":
      "ファン回転数・電圧・電力センサーが公開されていません（Super I/O 非対応プラットフォームの可能性があります）。",
    "state.loading": "データを読み込み中...",
    "state.emptyTitle": "データなし",
    "state.emptyDesc": "このカテゴリのデータまたは履歴サンプルはまだ報告されていません。",
    "state.requestFailed": "リクエスト失敗",
    "state.retry": "再試行",
    "state.permissionDenied": "権限不足：",
    "state.suggestion": "推奨対応：",
    "ws.connected": "リアルタイム接続中",
    "ws.connecting": "リアルタイム接続を試行中...",
    "ws.disconnected": "リアルタイム切断中（データが最新でない可能性があります）",
    "fmt.noData": "— (データなし)",
    "fmt.sensorFault": "— (センサー異常)",
    "fmt.day": "日",
    "fmt.hour": "時間",
    "fmt.min": "分",
    "cap.supported": "対応",
    "cap.unsupported": "非対応",
    "cap.permission_denied": "権限不足",
    "cap.unavailable": "利用不可",
    "cap.unknown": "不明",
    "devStatus.online": "オンライン",
    "devStatus.standby": "スタンバイ（未起床）",
    "devStatus.offline": "オフライン",
    "devStatus.unknown": "不明",
    "quality.valid": "有効",
    "quality.stale": "期限切れ",
    "quality.sensor_fault": "センサー異常",
    "quality.out_of_range": "範囲外",
    "quality.missing": "欠損",
    "sev.normal": "正常",
    "sev.warning": "警告",
    "sev.critical": "重大",
    "sev.unknown": "不明 / データ不足",
    "login.descLogin": "設定済みのアカウントでハードウェア監視コンソールにログインしてください。",
    "login.descBootstrap":
      "初回起動時は lhm-api の起動ログに出力されたワンタイムトークンで管理者を作成してください。",
    "login.tabLogin": "ログイン",
    "login.tabBootstrap": "初期管理者作成",
    "login.bootstrapToken": "ワンタイム初期化トークン (Bootstrap Token)",
    "login.bootstrapPlaceholder": "lhm-api の起動ログから取得",
    "login.username": "ユーザー名",
    "login.password": "パスワード（10 文字以上）",
    "login.submitting": "送信中...",
    "login.submitLogin": "ログイン",
    "login.submitBootstrap": "管理者を作成してログイン",
    "overview.loading": "システム概要を読み込み中...",
    "overview.notice":
      "フロントエンドは API の計測値と Haskell エンジンの分析結果のみを表示し、健全性の推測や欠損値の 0 補完は行いません。",
    "overview.host": "監視対象ホスト",
    "overview.waitAgent": "Agent からの報告を待機中",
    "overview.devices": "検出デバイス数",
    "overview.sensorCount": "センサー総数：",
    "overview.permDeniedDevices": "権限制限デバイス",
    "overview.staleDevices": "期限切れデバイス：",
    "overview.uptime": "ホスト稼働時間",
    "overview.lastHeartbeat": "最終ハートビート：",
    "overview.collectorsTitle": "コレクター稼働状況",
    "overview.noCollectors": "コレクター状態なし",
    "overview.noCollectorsDesc": "Rust Agent からの collector_status 報告を待機中です。",
    "overview.recentDiagnostics": "最近の診断ログ",
    "overview.noDiagnostics": "診断イベントはありません。",
    "overview.globalCheckBtn": "今すぐグローバル健全性チェック",
    "overview.globalChecking": "実機ハードウェア計測と健全性分析を実行中...",
    "overview.globalCheckHint": "12 時間超省電力モード稼働中。ボタンを押すといつでも即座に全ハードウェア計測と健全性診断を実行できます。",
    "overview.checkDonePrefix": "グローバル診断が完了しました（",
    "overview.checkAgentOk": "実機ハードウェアを即時取得",
    "overview.checkAgentSkip": "Agent 制御ソケット未接続のため最新保存データで評価",
    "overview.checkSummary": "評価結果：",
    "th.collector": "コレクター",
    "th.runStatus": "稼働状態",
    "th.capability": "対応状態",
    "th.interval": "周期",
    "th.collectInterval": "収集周期",
    "th.failures": "連続失敗",
    "th.lastSuccess": "最終成功時刻",
    "th.lastError": "最終エラー",
    "th.time": "時刻",
    "th.level": "レベル",
    "th.errorCode": "エラーコード",
    "th.device": "デバイス",
    "th.deviceStatus": "デバイス状態",
    "th.detailsAndRemediation": "詳細と推奨対応",
    "th.diagAndRemediation": "診断内容と対処方法",
    "th.collectorDevice": "コレクター / デバイス",
    "th.sensor": "センサー",
    "th.source": "取得元",
    "th.currentValue": "現在値",
    "th.quality": "品質",
    "th.collectedAt": "計測時刻",
    "th.protocol": "プロトコル",
    "th.smartSelfTest": "SMART 判定",
    "th.temperature": "温度",
    "th.powerOnHours": "通電時間",
    "th.dataUnitsRead": "読込データ単位 (128-bit)",
    "th.dataUnitsWritten": "書込データ単位 (128-bit)",
    "th.action": "操作",
    "th.attrName": "属性名",
    "th.rawValue": "Raw 値 (厳密文字列)",
    "th.stableDeviceId": "安定デバイス ID",
    "th.type": "種別",
    "th.nameModel": "名称 / モデル",
    "th.vendor": "ベンダー",
    "th.status": "状態",
    "th.lastSeen": "最終検出",
    "th.sensorId": "センサー ID",
    "th.name": "名称",
    "th.unit": "単位",
    "th.tempCap": "温度取得",
    "th.supportedMetrics": "対応メトリクス",
    "th.permDenied": "権限不足",
    "th.unsupported": "非対応",
    "th.stale": "期限切れ (stale)",
    "th.lastSuccessSample": "最終正常取得",
    "th.severity": "重要度",
    "th.deviceRule": "デバイス / ルール",
    "th.summary": "概要",
    "th.triggeredAt": "発生時刻",
    "th.ackInfo": "確認情報",
    "th.ruleId": "ルール ID",
    "th.deviceType": "デバイス種別",
    "th.metricCond": "条件",
    "th.duration": "継続時間",
    "th.deviceId": "デバイス ID",
    "th.severityLevel": "重要度",
    "th.score": "説明可能スコア",
    "th.trend": "傾向",
    "th.thresholdSource": "閾値ソース",
    "th.evidence": "根拠（要因 / 異常 / 相関）",
    "th.versionTime": "バージョン・時刻",
    "sensorCat.loadingPrefix": "読み込み中：",
    "sensorCat.emptySuffix": "：センサーなし",
    "sensorCat.deniedSubjectPrefix": "権限不足のため読み取れないメトリクス：",
    "sensorCat.deniedRemediation":
      "「診断・ログ」画面で最小権限の設定手順を確認してください。権限不足をハードウェア障害とみなさないでください。",
    "storage.loading": "ストレージ・SMART 情報を読み込み中...",
    "storage.titleAll": "ストレージ健全性 / SMART",
    "storage.titleNvme": "NVMe 監視",
    "storage.emptySuffix": "：デバイス未検出",
    "storage.emptyDesc": "このホストでは該当種別のストレージデバイスが検出されませんでした。",
    "storage.standbySkip": "スタンバイ中スキップ（未起床）",
    "storage.passed": "合格",
    "storage.failed": "異常",
    "storage.smartDetailBtn": "SMART 詳細",
    "storage.rawAttrTitle": "SMART Raw 属性：",
    "storage.noSmartReport":
      "このデバイスの SMART レポートはまだ受信していません（非 root 実行時は診断ログの SMART_PERMISSION_DENIED を確認してください）。",
    "storage.noAtaTable": "ATA 属性テーブルはありません。",
    "storage.lastCollectPrefix": "最終取得：",
    "storage.currentStatusPrefix": " / 状態：",
    "history.loading": "温度センサー一覧を読み込み中...",
    "history.noSensors": "利用可能な温度センサーがありません",
    "history.noSensorsDesc": "supported 状態の温度センサーが検出されていません。",
    "history.title": "温度履歴グラフ",
    "history.exportCsv": "CSV 出力",
    "history.exportJson": "JSON 出力",
    "history.rangeAria": "期間",
    "history.range15m": "直近 15 分 (生データ)",
    "history.range1h": "直近 1 時間 (生データ)",
    "history.range6h": "直近 6 時間 (1分集計)",
    "history.range24h": "直近 24 時間 (1分集計)",
    "history.range7d": "直近 7 日間 (1時間集計)",
    "history.noPoints": "選択期間内にデータがありません",
    "history.noPointsDesc": "期間を変更するか Agent のデータ送信をお待ちください。",
    "devices.loading": "ハードウェア一覧を読み込み中...",
    "devices.empty": "検出されたデバイスはありません",
    "devices.title": "ハードウェアデバイス一覧",
    "devices.inspectBtn": "識別詳細",
    "devices.identityTitle": "デバイス識別情報とトポロジ：",
    "coverage.loading": "センサー網羅率を読み込み中...",
    "coverage.empty": "網羅率レコードがありません",
    "coverage.titlePrefix": "センサー網羅率",
    "coverage.devicesUnit": "台のデバイス",
    "coverage.sensorsUnit": "個のセンサー",
    "coverage.staleThreshold": "期限切れ閾値",
    "coverage.tempOk": "対応・取得済み",
    "coverage.tempNoRead": "対応（未取得）",
    "coverage.tempNone": "なし",
    "diag.loading": "コレクター状態と診断ログを読み込み中...",
    "diag.collectorsTitle": "コレクター稼働状態",
    "diag.noCollectors": "コレクター報告なし",
    "diag.eventsTitle": "構造化診断イベント・ログ",
    "diag.noEvents": "診断ログはありません",
    "diag.noEventsDesc": "権限不足・タイムアウト・収集エラーは記録されていません。",
    "diag.remediationPrefix": "対処方法：",
    "alerts.loading": "アラートとルールを読み込み中...",
    "alerts.title": "アラート管理",
    "alerts.empty": "アラートはありません",
    "alerts.emptyDesc": "Haskell 健全性エンジンがアラートを発報するとここに表示されます。",
    "alerts.unacked": "未確認",
    "alerts.ackBtn": "確認済みにする",
    "alerts.rulesTitle": "アラートルール管理",
    "alerts.viewerDenied": "閲覧専用ロール (viewer) ではアラートルールの追加・削除はできません。",
    "alerts.viewerRemediation": "管理者 (admin) アカウントでログインしてルールを編集してください。",
    "alerts.warningPrefix": "閾値安全警告：",
    "alerts.ruleIdPlaceholder": "ルール ID",
    "alerts.thresholdPlaceholder": "閾値 °C",
    "alerts.durationPlaceholder": "継続秒数",
    "alerts.addRuleBtn": "アラートルールを追加",
    "alerts.presetBtn": "推奨安全ルールを一括適用",
    "alerts.presetDone": "推奨安全ルール（CPU / ストレージ / GPU / マザーボード）を適用しました（既存ルールは保持）。",
    "alerts.noRules": "カスタムアラートルールは未設定です（「推奨安全ルールを一括適用」を押すとすぐ有効化できます）。",
    "alerts.deleteBtn": "削除",
    "alertStatus.firing": "発報中",
    "alertStatus.resolved": "復旧済み",
    "alertStatus.pending": "保留中",
    "alertStatus.ok": "正常",
    "analysis.loading": "健全性分析を読み込み中...",
    "analysis.title": "健全性スコア・分析（Haskell エンジン）",
    "analysis.running": "分析中...",
    "analysis.runNow": "今すぐ分析を実行",
    "analysis.empty": "分析結果がまだありません",
    "analysis.emptyDesc": "Haskell 健全性エンジンが稼働していることを確認し、「今すぐ分析を実行」を押してください。",
    "analysis.unscorable": "— (評価不可)",
    "analysis.anomalyPrefix": "異常",
    "analysis.correlationPrefix": "相関",
    "config.loading": "システム設定を読み込み中...",
    "config.title": "システム設定",
    "config.viewerDenied": "閲覧専用ロール (viewer) ではシステム設定を変更できません。",
    "config.viewerRemediation": "保持期間や期限切れ閾値を変更するには管理者 (admin) でログインしてください。",
    "config.savedNotice": "設定を保存し、監査ログに記録しました。",
    "config.staleLabel": "データ期限切れ閾値（秒）",
    "config.rawDaysLabel": "生データ保持日数（既定 14 日）",
    "config.defaultsNote1": "既定の集計保持期間：1分集計",
    "config.defaultsNote2": "日・1時間集計",
    "config.defaultsNote3": "日・SMART 履歴",
    "config.defaultsNote4": "日（機密設定はフロントエンドへ送信されません）。",
    "config.saving": "保存中...",
    "config.saveBtn": "設定を保存（監査ログ記録）",
    "config.langTitle": "画面・ログ表示言語",
    "config.langDesc":
      "画面 UI、コレクター状態、診断ログ、対処方法、健全性分析の説明を即座に日本語 / 英語 / 中国語へ切り替えます。",
    "config.exportTitle": "データエクスポート",
    "config.exportReportBtn": "匿名化済み健全性・診断レポート出力 (JSON)",
    "config.exportReportDesc":
      "ホスト・デバイス・網羅率・最新分析・アラート・診断ログを含み、認証情報と機密設定は自動的に除外されます。",
    "config.webhookTitle": "アラート通知 (Webhook)",
    "config.webhookSaved": "Webhook 通知設定を保存しました（シークレットは安全に保管されます）。",
    "config.webhookTestOk": "テスト通知を送信しました",
    "config.webhookTestFail": "テスト通知の送信に失敗しました：",
    "config.webhookEnable": "アラート状態変化時に Webhook 通知を送信する",
    "config.webhookUrl": "Webhook URL（http/https のみ許可・メタデータ SSRF 遮断済み）",
    "config.webhookSecret": "HMAC-SHA256 署名シークレット（任意、状態：",
    "config.secretConfigured": "設定済み",
    "config.secretNotConfigured": "未設定",
    "config.secretPlaceholder": "変更しない場合は空欄",
    "config.saveNotifBtn": "通知設定を保存",
    "config.testNotifBtn": "テスト通知を送信",
  },
};

export function translate(locale: Locale, key: string): string {
  return DICTIONARIES[locale][key] ?? DICTIONARIES.zh[key] ?? key;
}

export function translateCapability(
  locale: Locale,
  status: CapabilityStatus,
): { label: string; tone: "ok" | "warn" | "muted" | "err" } {
  const tones: Record<CapabilityStatus, "ok" | "warn" | "muted" | "err"> = {
    supported: "ok",
    unsupported: "muted",
    permission_denied: "warn",
    unavailable: "muted",
    unknown: "muted",
  };
  return { label: translate(locale, `cap.${status}`), tone: tones[status] ?? "muted" };
}

export function translateDeviceStatus(
  locale: Locale,
  status: DeviceStatus,
): { label: string; tone: "ok" | "standby" | "err" | "muted" } {
  const tones: Record<DeviceStatus, "ok" | "standby" | "err" | "muted"> = {
    online: "ok",
    standby: "standby",
    offline: "err",
    unknown: "muted",
  };
  return { label: translate(locale, `devStatus.${status}`), tone: tones[status] ?? "muted" };
}

export function translateQuality(
  locale: Locale,
  quality: ReadingQuality,
): { label: string; tone: "ok" | "warn" | "err" | "muted" } {
  const tones: Record<ReadingQuality, "ok" | "warn" | "err" | "muted"> = {
    valid: "ok",
    stale: "warn",
    sensor_fault: "err",
    out_of_range: "warn",
    missing: "muted",
  };
  return { label: translate(locale, `quality.${quality}`), tone: tones[quality] ?? "muted" };
}

export function translateCollectorStatus(locale: Locale, status: string): string {
  const map: Record<Locale, Record<string, string>> = {
    zh: { running: "运行中", degraded: "降级运行", error: "错误", stopped: "已停止", unknown: "未知" },
    en: { running: "Running", degraded: "Degraded", error: "Error", stopped: "Stopped", unknown: "Unknown" },
    ja: { running: "稼働中", degraded: "縮退運転", error: "エラー", stopped: "停止", unknown: "不明" },
  };
  return map[locale][status.toLowerCase()] ?? status;
}

export function translateLogLevel(locale: Locale, level: string): string {
  const map: Record<Locale, Record<string, string>> = {
    zh: { info: "信息 (INFO)", warn: "警告 (WARN)", error: "错误 (ERROR)" },
    en: { info: "INFO", warn: "WARN", error: "ERROR" },
    ja: { info: "情報 (INFO)", warn: "警告 (WARN)", error: "エラー (ERROR)" },
  };
  return map[locale][level.toLowerCase()] ?? level;
}

export function translateTrend(locale: Locale, trend: string): string {
  const map: Record<Locale, Record<string, string>> = {
    zh: { rising: "上升", stable: "稳定", falling: "下降", insufficient_data: "数据不足" },
    en: { rising: "Rising", stable: "Stable", falling: "Falling", insufficient_data: "Insufficient Data" },
    ja: { rising: "上昇", stable: "安定", falling: "下降", insufficient_data: "データ不足" },
  };
  return map[locale][trend] ?? trend;
}

export function translateThresholdSource(locale: Locale, src: string): string {
  const map: Record<Locale, Record<string, string>> = {
    zh: {
      user_device_override: "用户单设备规则",
      user_type_rule: "用户设备类型规则",
      hardware_limit: "硬件上报限值",
      generic_default: "通用默认阈值",
      unavailable: "无可用阈值",
    },
    en: {
      user_device_override: "User Device Override",
      user_type_rule: "User Type Rule",
      hardware_limit: "Hardware Limit",
      generic_default: "Generic Default",
      unavailable: "Unavailable",
    },
    ja: {
      user_device_override: "ユーザー個別設定",
      user_type_rule: "ユーザー種別ルール",
      hardware_limit: "ハードウェア上限値",
      generic_default: "標準既定閾値",
      unavailable: "閾値なし",
    },
  };
  return map[locale][src] ?? src;
}

/**
 * Localizes structured diagnostic logs & remediation hints from Rust Agent / Bun API
 * into Chinese, English, or Japanese while preserving exact device paths and error codes.
 */
export function translateDiagnostic(
  locale: Locale,
  d: Pick<DiagnosticRow, "errorCode" | "message" | "remediation">,
): { message: string; remediation: string | null } {
  if (locale === "en") {
    return { message: d.message, remediation: d.remediation };
  }

  const pathMatch = d.message.match(/(\/(?:dev|sys|proc|run)\/[^\s,;)]+)/);
  const targetPath = pathMatch ? pathMatch[1] : "";

  switch (d.errorCode) {
    case "SMART_PERMISSION_DENIED":
      return locale === "zh"
        ? {
            message: `执行 smartctl 读取 ${targetPath || "磁盘设备"} 时权限不足`,
            remediation:
              "通过 systemd 最小权限单元授予 CAP_SYS_RAWIO 与 disk 组读取权限（ADR-0006）即可启用 SMART 采集；这不是硬件故障。",
          }
        : {
            message: `smartctl による ${targetPath || "ディスクデバイス"} の読み取り権限が不足しています`,
            remediation:
              "systemd の最小権限ユニットで CAP_SYS_RAWIO と disk グループの読み取り権限（ADR-0006）を付与してください（ハードウェア障害ではありません）。",
          };
    case "RAPL_PERMISSION_DENIED":
      return locale === "zh"
        ? {
            message: `读取 Intel RAPL 功耗接口 ${targetPath || "energy_uj"} 时权限不足`,
            remediation:
              "若需要 CPU 封装功耗统计，可通过最小权限配置授予 intel-rapl energy_uj 只读权限（Linux 默认仅 root 可读以缓解侧信道风险）。",
          }
        : {
            message: `Intel RAPL 電力インターフェース ${targetPath || "energy_uj"} の読み取り権限が不足しています`,
            remediation:
              "CPU パッケージ消費電力の計測が必要な場合は、最小権限で intel-rapl energy_uj の読み取り権限を付与してください。",
          };
    case "HEALTH_ENGINE_UNAVAILABLE":
      return locale === "zh"
        ? {
            message: `Haskell 健康分析引擎不可达，已将分析状态安全降级为 unknown（${d.message}）`,
            remediation: "请检查 lhm-health-engine 容器运行状态及 LHM_HEALTH_ENGINE_URL 配置。",
          }
        : {
            message: `Haskell 健全性エンジンに接続できないため、分析状態を unknown に縮退しました（${d.message}）`,
            remediation: "lhm-health-engine コンテナの稼働状態と LHM_HEALTH_ENGINE_URL 設定を確認してください。",
          };
    case "SMARTCTL_NOT_FOUND":
      return locale === "zh"
        ? {
            message: `宿主机未找到 smartctl 可执行文件（${targetPath || "/usr/sbin/smartctl"}）`,
            remediation: "请在 Debian 宿主机安装 smartmontools（>= 7.0）。",
          }
        : {
            message: `ホスト上に smartctl 実行ファイルが見つかりません（${targetPath || "/usr/sbin/smartctl"}）`,
            remediation: "Debian ホストに smartmontools（>= 7.0）をインストールしてください。",
          };
    case "SMART_UNSUPPORTED":
      return locale === "zh"
        ? {
            message: `${targetPath || "该磁盘"} 不支持 SMART 遥测`,
            remediation: d.remediation ? d.remediation : null,
          }
        : {
            message: `${targetPath || "対象ディスク"} は SMART テレメトリに非対応です`,
            remediation: d.remediation ? d.remediation : null,
          };
    case "IPC_BUFFER_DROPPED":
      return locale === "zh"
        ? {
            message: "IPC 本地有界缓存已满，已按策略丢弃最旧采样批次以防止内存溢出",
            remediation: "请检查 Bun API 容器是否正常监听 Unix Socket。",
          }
        : {
            message: "IPC メモリバッファが上限に達したため、OOM 防止のため最古のバッチを破棄しました",
            remediation: "Bun API コンテナが Unix Socket を正常に待ち受けているか確認してください。",
          };
    case "WALL_CLOCK_ROLLBACK":
      return locale === "zh"
        ? {
            message: "检测到宿主机系统时钟回拨，采集周期已由单调时钟保持稳定",
            remediation: "请检查宿主机 NTP 时间同步服务状态。",
          }
        : {
            message: "ホストのシステム時刻の巻き戻りを検出しました（収集周期は単調クロックで維持されています）",
            remediation: "ホストの NTP 時刻同期状態を確認してください。",
          };
    case "COLLECTOR_TIMEOUT":
    case "COLLECTOR_DISCOVERY_TIMEOUT":
      return locale === "zh"
        ? {
            message: `采集器任务执行超时（${d.message}）`,
            remediation: "请检查对应硬件驱动响应或宿主机 I/O 负载，该故障已隔离不影响其他采集器。",
          }
        : {
            message: `コレクタータスクがタイムアウトしました（${d.message}）`,
            remediation: "該当ドライバの応答やホスト I/O 負荷を確認してください（他コレクターへは影響しません）。",
          };
    default:
      return { message: d.message, remediation: d.remediation };
  }
}

/**
 * Localizes Haskell health analysis factor/anomaly/correlation text while preserving
 * key codes (like DATA_STALE) and numeric measurements.
 */
export function translateAnalysisText(locale: Locale, text: string): string {
  if (locale === "en") return text;

  if (text.includes("DATA_STALE")) {
    return locale === "zh"
      ? `DATA_STALE：采样数据已过期，无法判定为正常（${text}）`
      : `DATA_STALE：データが期限切れのため正常と判定できません（${text}）`;
  }
  if (text.includes("SENSOR_FAULT")) {
    return locale === "zh"
      ? `SENSOR_FAULT：传感器报告故障，不计入健康分（${text}）`
      : `SENSOR_FAULT：センサー異常のためスコア評価対象外です（${text}）`;
  }
  if (text.includes("DEVICE_STANDBY") || text.toLowerCase().includes("standby")) {
    return locale === "zh"
      ? "设备处于待机状态（未唤醒），不计入扣分"
      : "デバイスはスタンバイ状態（未起床）のため減点対象外です";
  }
  if (text.includes("Health engine unavailable")) {
    return locale === "zh"
      ? "健康分析引擎暂不可达，已降级为未知状态"
      : "健全性エンジンに接続できないため不明状態へ縮退しました";
  }
  if (text.includes("No valid readings") || text.includes("No scorable")) {
    return locale === "zh"
      ? "当前无有效可评分传感器采样"
      : "評価可能な有効センサー計測値がありません";
  }
  if (text.includes("within normal") || text.includes("Healthy baseline")) {
    return locale === "zh"
      ? "各项已采集指标处于正常基准范围内"
      : "取得済みの各メトリクスは正常基準範囲内です";
  }
  if (text.startsWith("Latest value ") && text.includes("robust median")) {
    const nums = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (nums.length >= 3) {
      return locale === "zh"
        ? `最新值 ${nums[0]} 显著偏离鲁棒中位数 ${nums[1]}（MAD=${nums[2]}）`
        : `最新値 ${nums[0]} がロバスト中央値 ${nums[1]} から大きく乖離しています（MAD=${nums[2]}）`;
    }
  }
  if (text.startsWith("Latest value ") && text.includes("baseline mean")) {
    const nums = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (nums.length >= 2) {
      return locale === "zh"
        ? `最新值 ${nums[0]} 显著偏离历史均值 ${nums[1]}`
        : `最新値 ${nums[0]} が過去平均値 ${nums[1]} から大きく乖離しています`;
    }
  }
  if (text.startsWith("Abrupt single-interval jump")) {
    const nums = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (nums.length >= 3) {
      return locale === "zh"
        ? `单次采样突发跳变 ${nums[0]}（从 ${nums[1]} 跃升至 ${nums[2]}）`
        : `単一間隔で ${nums[0]} の急激な変化を検出（${nums[1]} → ${nums[2]}）`;
    }
  }
  if (text.includes("fan") && text.includes("0")) {
    return locale === "zh"
      ? "高温伴随风扇转速 0 RPM，请立即检查散热风扇"
      : "高温時にファン回転数 0 RPM を検出しました。冷却ファンを確認してください";
  }
  return text;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh",
  setLocale: () => {},
  t: (key: string) => translate("zh", key),
});

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectInitialLocale());

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = localeToBcp47(locale);
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key: string) => translate(locale, key),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <select
      aria-label={t("shell.language")}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      style={{ padding: "5px 8px", fontSize: 12 }}
    >
      {LOCALE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
