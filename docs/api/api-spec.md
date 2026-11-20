# Bun API 规范

## 1. 约定

- 统一前缀 `/api/v1`。
- 列表接口支持分页（`limit`、`cursor`）、过滤、排序；历史接口支持时间范围（`from`、`to`）与聚合粒度（`raw`、`1m`、`1h`）。
- 除登录与服务健康检查外，所有接口需要认证。
- 所有数据库操作经 Repository 层，Route 内不写复杂 SQL。

## 2. 统一响应

```json
{
  "success": true,
  "data": {},
  "error": null,
  "request_id": "req-000001",
  "timestamp": "2026-11-20T10:00:00Z"
}
```

错误时 `error` 为 `{ "code": "SENSOR_NOT_FOUND", "message": "...", "details": {} }`。`code` 是稳定的大写蛇形错误代码，客户端只依赖 `code`，不依赖 `message`。错误代码表维护在本目录 `error-codes.md`（阶段 2 建立）。

## 3. 端点

| 方法 | 路径 | 用途 | 阶段 |
| ---- | ---- | ---- | ---- |
| GET | /api/v1/health | 服务健康检查（无需认证，用于 Docker healthcheck，不返回敏感信息） | 2 |
| POST | /api/v1/auth/login | 登录 | 2 |
| POST | /api/v1/auth/logout | 登出 | 2 |
| GET | /api/v1/auth/me | 当前用户 | 2 |
| GET/POST/PATCH/DELETE | /api/v1/users | 用户管理（管理员） | 2 |
| GET | /api/v1/system/overview | 总览 | 2 |
| GET | /api/v1/hosts | 主机列表（v1 仅单主机） | 2 |
| GET | /api/v1/devices | 设备列表 | 2 |
| GET | /api/v1/devices/:id | 设备详情 | 2 |
| GET | /api/v1/sensors | 传感器列表 | 2 |
| GET | /api/v1/sensors/:id/readings | 历史采样 | 2 |
| GET | /api/v1/coverage | 传感器覆盖率 | 2 |
| GET | /api/v1/storage | 存储健康总览 | 2 |
| GET | /api/v1/storage/:id/smart | 单设备 SMART 详情与历史 | 2 |
| GET | /api/v1/collectors | 采集器状态 | 2 |
| GET | /api/v1/diagnostics | 诊断 | 2 |
| GET | /api/v1/config | 配置（不含敏感项） | 2 |
| PUT | /api/v1/config | 更新配置（管理员，写审计日志） | 2 |
| GET | /api/v1/stream | WebSocket | 2 |
| GET | /api/v1/analysis | 健康分析结果 | 4 |
| POST | /api/v1/analysis/run | 触发一次健康分析（管理员） | 4 |
| GET | /api/v1/alerts | 告警列表 | 4 |
| POST | /api/v1/alerts/:id/ack | 确认告警 | 4 |
| GET/POST/PATCH/DELETE | /api/v1/alert-rules | 告警规则管理 | 4 |
| GET | /api/v1/export/readings | 安全导出单传感器采样（CSV/JSON，上限 10,000 行，CSV 防公式注入） | 6 |
| GET | /api/v1/export/report | 导出脱敏健康与诊断快照报告（JSON，不含用户凭据与敏感配置） | 6 |
| GET/PUT | /api/v1/notifications | 告警 Webhook 通知配置（写操作仅管理员，含 SSRF 校验与密钥脱敏） | 6 |
| POST | /api/v1/notifications/test | 发送签名测试 Webhook（管理员，写审计日志） | 6 |

## 4. WebSocket

- 认证：复用登录会话（Cookie），握手时校验 Origin。
- 客户端发送订阅消息（按设备 / 传感器 / 主题），服务端只推送订阅内容的**增量**。
- 服务端消息格式：`{ "type": "...", "data": {...}, "timestamp": "..." }`，类型至少包括 `reading`、`device_status`、`collector_status`、`alert`（阶段 4）、`ping`。
- 断线重连后客户端通过 REST 补齐断线期间的数据，不得通过 WebSocket 拉取历史。
- 消息结构在 `packages/protocol` 中定义 Schema。
