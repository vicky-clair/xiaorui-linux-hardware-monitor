# Linux Hardware Monitor Desktop Client (Tauri 2 — Phase 6)

> 职责边界（`AGENTS.md §4`）：本目录为纯桌面客户端外壳，通过 REST / WebSocket 连接远端或局域网 Bun API / Nginx 控制台，**严禁在桌面端执行服务端硬件采集或直连 SQLite**。

## 说明

- WebView 前端复用 `apps/web/dist` 构建产物，或通过环境变量 `LHM_SERVER_URL` 指向局域网控制台（例如 `http://192.168.9.165:18080`）。
- 服务端 `apps/api` 与 `deploy/docker/.env.example` 已放行 Tauri 2 WebSocket Origin：`tauri://localhost`、`http://tauri.localhost`。
- 为避免在无头 Debian 服务器构建 Rust Agent 时引入 GTK/WebKitGUI 依赖，本目录独立于根 `Cargo.toml` workspace。

## 本地桌面打包前置条件（待在带桌面工具链的开发机上实测）

- Windows：MSVC Build Tools + WebView2 Runtime + `@tauri-apps/cli@^2`
- Debian 13 桌面环境：`libwebkit2gtk-4.1-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`
- 执行方式：`cd apps/desktop && bun install && bun run tauri build`
