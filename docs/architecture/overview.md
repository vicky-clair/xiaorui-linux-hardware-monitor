# 总体架构

## 1. 目标

面向 Linux 主机的硬件监控与健康分析平台。以 Scrutiny 的 SMART 监控为参考，扩展到 CPU、GPU、主板、内存、存储、风扇、电压、功耗与系统资源，提供历史存储、实时推送、健康分析、告警、传感器覆盖率与采集器诊断，通过局域网 Web 控制台访问。

不以复制 Scrutiny 为目标，而是建立可扩展的平台。

## 2. 数据流

```
采集：  Linux 硬件 → Rust Agent（systemd，原生）→ Unix Domain Socket → Bun API → SQLite
展示：  React → REST API → Bun API；Bun API → WebSocket → React（增量）
分析：  Bun API → Haskell Health Engine → 分析结果 → Bun API → SQLite
```

| 数据处理 | 责任组件 |
| -------- | -------- |
| 设备 / 传感器发现、原始读取、标准化、IPC 发送 | Rust |
| 数据校验、业务写入、历史查询、聚合与保留、告警生命周期 | Bun |
| 规则、阈值、趋势、异常、关联、评分、告警判定 | Haskell |
| 展示与交互 | React |

## 3. 强制约束

1. Rust Agent 原生运行在宿主机，由 systemd 管理。
2. Bun API、Web（Nginx 托管静态构建产物）、Haskell 引擎通过 Docker Compose 部署。
3. API 容器不访问宿主机 `/sys`、`/proc`、`/dev`。
4. 不得用 `privileged: true` 解决普通权限问题。
5. Agent 与 API 只通过受控 Unix Socket 通信，使用版本化协议。
6. Bun API 是 SQLite 唯一业务写入者；Rust 和 Haskell 不接触数据库。
7. 前端只访问 Bun API。

## 4. 部署拓扑注意事项

- **Socket 挂载**：`/run` 是 tmpfs，服务重启后 socket 文件 inode 会变化。容器应挂载**目录**（如 `/run/linux-hardware-monitor/`）而不是单个 socket 文件。
- **权限映射**：socket 所属组需要与容器内运行用户的 GID 对应，具体方案在 ADR-0003 / ADR-0006 中确定。
- **systemd tmpfiles**：socket 目录由 `RuntimeDirectory=` 或 tmpfiles.d 创建，并在文档中说明权限。
- **SQLite 卷**：数据库放在本地卷（不得放在网络文件系统上，WAL 模式不支持）。

## 5. 未决设计（必须通过 ADR 确定，未确定前不得自行实现）

| 问题 | ADR |
| ---- | --- |
| Socket 归属与连接方向（谁 listen，谁 connect）、分帧、心跳、缓冲重放 | 0003 |
| Bun ↔ Haskell 通信方式与状态机持久化 | 0004 |
| 协议类型生成方式 | 0005 |
| Agent 权限模型 | 0006 |
| 告警判定与告警生命周期的边界 | 0007 |
| 多主机传输（Unix Socket 无法跨主机） | 0010 |

## 6. 范围说明

- v1 只支持**单主机**。数据模型保留 `host_id` 字段以便扩展，但 v1 不承诺多主机 API 行为。
- Tauri 2 桌面客户端属于阶段 6，复用 Web 控制台，不负责采集。
