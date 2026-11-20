# 架构决策记录（ADR）

## 规则

1. 技术栈变更、跨模块接口、协议结构、权限模型、部署拓扑等决定必须写成 ADR。
2. ADR 文件名：`NNNN-简短标题.md`，使用 [0000-template.md](0000-template.md)。
3. 状态：`proposed`（提议）→ `accepted`（已批准）/ `rejected`（否决）→ `superseded`（被取代）。
4. 只有项目所有者可以把 ADR 置为 `accepted`。
5. **ADR 未 accepted 前，代理不得实现依赖该决定的代码**，可以编写原型但必须标注"原型，待 ADR 批准"。

## ADR 清单

| 编号 | 主题 | 文档 | 截止阶段 | 状态 |
| ---- | ---- | ---- | -------- | ---- |
| 0001 | 版本矩阵 | [0001-version-matrix.md](0001-version-matrix.md) | 阶段 0 | accepted |
| 0002 | 开发与验证环境 | [0002-dev-and-verification-env.md](0002-dev-and-verification-env.md) | 阶段 0 | accepted |
| 0003 | Agent ↔ API IPC | [0003-agent-api-ipc.md](0003-agent-api-ipc.md) | 阶段 0 | accepted |
| 0004 | Bun ↔ Haskell 接口 | [0004-bun-haskell-interface.md](0004-bun-haskell-interface.md) | 阶段 0 | accepted |
| 0005 | 协议单一事实来源 | [0005-protocol-single-source-of-truth.md](0005-protocol-single-source-of-truth.md) | 阶段 0 | accepted |
| 0006 | Agent 权限模型 | [0006-agent-permission-model.md](0006-agent-permission-model.md) | 阶段 0 | accepted |
| 0007 | 告警职责划分 | [0007-alert-responsibility-boundary.md](0007-alert-responsibility-boundary.md) | 阶段 0 | accepted |
| 0008 | Rust crate 划分 | 待起草 | 阶段 1 前 | 待提出 |
| 0009 | 局域网 HTTPS 证书 | 待起草 | 阶段 5 前 | 待提出 |
| 0010 | 多主机传输 | 待起草 | 阶段 6 前 | 待提出 |
