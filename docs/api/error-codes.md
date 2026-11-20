# API 错误代码规范

客户端只允许依赖 `error.code`（稳定的大写蛇形错误代码），不得解析自然语言 `error.message`。

| 错误代码 | HTTP 状态码 | 含义 |
| -------- | ----------- | ---- |
| `UNAUTHORIZED` | 401 | 未登录或会话已过期 |
| `FORBIDDEN` | 403 | 权限不足（例如 `viewer` 尝试管理员操作） |
| `INVALID_CREDENTIALS` | 401 | 用户名或密码错误 |
| `TOO_MANY_ATTEMPTS` | 429 | 登录失败次数过多，已触发限流 |
| `BOOTSTRAP_ALREADY_COMPLETED` | 403 | 系统已完成初始管理员引导 |
| `INVALID_BOOTSTRAP_TOKEN` | 403 | 一次性引导令牌无效 |
| `INVALID_ORIGIN` | 403 | 请求或 WebSocket 握手 `Origin` 校验失败 |
| `VALIDATION_ERROR` | 400 | 请求参数或请求体校验失败 |
| `NOT_FOUND` | 404 | 请求的资源不存在 |
| `DEVICE_NOT_FOUND` | 404 | 指定设备不存在 |
| `SENSOR_NOT_FOUND` | 404 | 指定传感器不存在 |
| `USER_NOT_FOUND` | 404 | 指定用户不存在 |
| `USER_ALREADY_EXISTS` | 409 | 用户名已存在 |
| `CANNOT_DELETE_SELF` | 400 | 管理员不能删除或禁用当前登录账户自身 |
| `INTERNAL_ERROR` | 500 | 服务端未预期内部错误 |
