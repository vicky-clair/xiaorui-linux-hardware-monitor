// REST API 统一响应信封与请求追踪 ID 封装（成功/错误响应遵循 docs/api/api-spec.md 规范）。
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorBody | null;
  request_id: string;
  timestamp: string;
}

export function newRequestId(): string {
  return `req-${crypto.randomUUID()}`;
}

export function okResponse<T>(
  data: T,
  requestId: string = newRequestId(),
): ApiEnvelope<T> {
  return {
    success: true,
    data,
    error: null,
    request_id: requestId,
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  requestId: string = newRequestId(),
): ApiEnvelope<null> {
  return {
    success: false,
    data: null,
    error: details ? { code, message, details } : { code, message },
    request_id: requestId,
    timestamp: new Date().toISOString(),
  };
}
