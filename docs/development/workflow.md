# 开发流程

## 1. 阶段划分

不得在前一阶段尚未由项目所有者验收时进入下一阶段。当前阶段见 [../status.md](../status.md)。

### 阶段 0：基础工程

任务（按顺序）：

1. **项目检查**：工作目录、Git 状态（当前目录尚未初始化 Git，需先初始化）、已有文件、开发环境。
2. **ADR**：提出并获批 ADR-0001 至 0007（见 [../decisions/README.md](../decisions/README.md)）。
3. **工程初始化**：根 `package.json`（Bun workspaces：`apps/*`、`packages/protocol/typescript`）、Rust workspace、Bun API、React + Vite、Haskell Cabal（`cabal.project` 引用 `packages/protocol/haskell`）、共享协议目录。
4. **协议基础**：Host、Device、Sensor、SensorReading、CollectorStatus、Diagnostic、IPC Message 的 JSON Schema 与跨语言类型、示例、跨语言测试。
5. **架构文档**：根据 ADR 更新 `docs/`。
6. **基础 CI**：Rust 格式 / 编译 / 测试 / clippy，TypeScript 类型检查，Bun 测试，React 构建，Haskell 编译 / 测试，协议校验（示例通过 Schema、各语言类型一致）。
7. **填写 AGENTS.md §8 命令表与版本矩阵。**

验收：所有工程可独立构建；共享协议可被各语言解析；CI 可执行基础检查；ADR 0001–0007 已批准。

### 阶段 1：Rust Agent

任务：设备发现、hwmon、thermal、CPU、内存、存储、SMART、NVMe、GPU 自动识别、传感器覆盖率、采集器诊断、IPC 客户端（可对接 mock 接收端）。

验收：Debian 13 原生运行；设备自动发现；支持的传感器正确采集；不支持的传感器正确报告；采集错误可诊断；单个采集器故障不导致 Agent 退出；HDD 待机时不被唤醒。

### 阶段 2：Bun API

任务：IPC 接收、协议校验、SQLite 与 Migration、数据持久化、聚合与保留任务、设备管理、历史查询、REST API、WebSocket、认证（含初始管理员创建）、配置。

验收：Agent 数据正常接收；数据库正常写入；API 可查询历史；服务重启后数据保留；Agent 断线重连后数据按 ADR-0003 补齐或明确标记缺口。

### 阶段 3：React Web

任务：总览、CPU、GPU、主板、内存、存储 / SMART、NVMe、温度历史、风扇与电压、设备列表、传感器覆盖率、采集器诊断、系统配置。

验收：局域网可访问；实时数据正常显示；历史数据正常查询；缺失 / 不支持数据正确显示。

> 告警中心与健康评分页面依赖阶段 4，不在阶段 3 范围内。

### 阶段 4：Haskell 健康分析与告警

任务：规则引擎、阈值管理、趋势分析、异常检测、关联分析、健康评分、告警状态机；Bun 侧告警生命周期与规则管理 API；Web 告警中心与健康评分展示。

验收：分析结果有明确依据；规则可配置；分析结果可追溯；告警可产生、确认、恢复。

### 阶段 5：生产部署

任务：systemd、Docker Compose、Nginx、HTTPS、数据备份与恢复、权限加固、性能测试、长期运行测试。

验收：服务自动启动；容器重建不丢数据；Agent 重启自动恢复；数据库恢复演练成功；连续运行测试通过。

### 阶段 6：扩展

IPMI、Redfish、多主机（需 ADR-0010）、通知、Tauri、数据导出、高级异常检测。

## 2. 文件修改纪律

修改前：确认文件用途、检查引用关系、评估对其他模块的影响、是否需要测试与迁移。

禁止：无理由重写整个项目、删除未理解的代码、修改无关文件、删除用户配置、覆盖用户数据、删除数据库或历史记录、修改密钥、未告知用户修改宿主机配置。

修改后：检查 diff、运行格式化、运行相关测试、检查构建、更新相关文档。

## 3. 数据库纪律

必须创建 Migration；考虑旧数据兼容、回滚与备份；不得删除现有数据；未经授权不得 DROP TABLE；修改字段语义必须附迁移说明。

## 4. 命令执行纪律

在 Linux 主机执行命令前判断：是否需要 sudo、是否修改系统、是否影响 Docker / systemd、是否改变文件权限、是否可能丢数据、是否需要备份。破坏性操作必须先说明影响并取得明确授权。

## 5. Git

- 使用 Git；提交信息采用 Conventional Commits：

```
feat(agent): add hwmon discovery
feat(api): add sensor history endpoint
fix(smart): handle permission denied
refactor(protocol): normalize sensor status
test(agent): add mock sysfs tests
docs(architecture): update data flow
```

- 重要阶段打 Tag；重大架构修改建立 ADR。
- 提交依赖锁文件；不提交数据库文件、密钥、生产日志、构建产物。

## 6. 性能与可靠性目标

以下为**待验证的工程目标**，不是已实现的承诺。不得在没有实测的情况下宣称达到。

| 指标 | 初始目标 |
| ---- | -------- |
| CPU / GPU 高频采集周期 | 3 秒 |
| Agent 心跳 | 10 秒 |
| 设备发现周期 | 60 秒 |
| Agent CPU 占用 | 低于 2% |
| Agent 内存占用 | 低于 150 MB |
| 长期运行测试 | 至少 7 天 |

需实测：Agent CPU / 内存、采集延迟、数据库写入性能、WebSocket 延迟、采集失败恢复时间、长期稳定性。

## 7. 文档维护

文档必须与代码一致；禁止保留过期的部署命令与配置示例。新增目录必须遵循职责边界并更新 AGENTS.md §6 目录地图。
