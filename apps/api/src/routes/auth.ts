// 认证与管理路由：包含首次管理员引导、登录/登出、当前用户查询、用户管理及系统配置读写（敏感项自动脱敏）。
import { Elysia } from "elysia";
import {
  AuthError,
  parseCookies,
  SESSION_COOKIE_NAME,
  type AuthService,
} from "../auth/service.ts";
import { errorResponse, okResponse } from "../middleware/envelope.ts";
import type { AuthRepository, UserRole } from "../repositories/authRepo.ts";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
  );
}

export function createAuthRoutes(authService: AuthService, authRepo: AuthRepository) {
  return new Elysia({ prefix: "/api/v1" })
    .post("/auth/bootstrap", async ({ request, body, set }) => {
      try {
        const b = (body ?? {}) as Record<string, unknown>;
        const user = await authService.bootstrapAdmin({
          token: String(b.bootstrap_token ?? ""),
          username: String(b.username ?? ""),
          password: String(b.password ?? ""),
          ipAddress: clientIp(request),
        });
        set.status = 201;
        return okResponse({ user });
      } catch (err) {
        if (err instanceof AuthError) {
          set.status = err.status;
          return errorResponse(err.code, err.message);
        }
        throw err;
      }
    })
    .post("/auth/login", async ({ request, body, set }) => {
      try {
        const b = (body ?? {}) as Record<string, unknown>;
        const result = await authService.login({
          username: String(b.username ?? ""),
          password: String(b.password ?? ""),
          ipAddress: clientIp(request),
          userAgent: request.headers.get("user-agent") ?? undefined,
        });
        set.headers["set-cookie"] = result.cookieHeader;
        return okResponse({ user: result.user });
      } catch (err) {
        if (err instanceof AuthError) {
          set.status = err.status;
          return errorResponse(err.code, err.message);
        }
        throw err;
      }
    })
    .post("/auth/logout", ({ request, set }) => {
      const cookies = parseCookies(request.headers.get("cookie"));
      const session = authService.authenticateRequest(request);
      const clearCookie = authService.logout(
        cookies[SESSION_COOKIE_NAME],
        session,
        clientIp(request),
      );
      set.headers["set-cookie"] = clearCookie;
      return okResponse({ logged_out: true });
    })
    .get("/auth/me", ({ request, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse({ user: session });
    })
    .get("/users", ({ request, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      return okResponse({ users: authRepo.listUsers() });
    })
    .post("/users", async ({ request, body, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      const b = (body ?? {}) as Record<string, unknown>;
      const username = String(b.username ?? "").trim();
      const password = String(b.password ?? "");
      const role = String(b.role ?? "viewer") as UserRole;
      if (role !== "admin" && role !== "viewer") {
        set.status = 400;
        return errorResponse("VALIDATION_ERROR", "Role must be 'admin' or 'viewer'");
      }
      try {
        authService.validateUsernameAndPassword(username, password);
      } catch (err) {
        if (err instanceof AuthError) {
          set.status = err.status;
          return errorResponse(err.code, err.message);
        }
        throw err;
      }
      if (authRepo.findUserByUsername(username)) {
        set.status = 409;
        return errorResponse("USER_ALREADY_EXISTS", `User '${username}' already exists`);
      }
      const hash = await authService.hashPassword(password);
      const created = authRepo.createUser({
        userId: `usr-${crypto.randomUUID()}`,
        username,
        passwordHash: hash,
        role,
      });
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "USER_CREATE",
        targetType: "user",
        targetId: created.user_id,
        details: { username: created.username, role: created.role },
        ipAddress: clientIp(request),
      });
      set.status = 201;
      return okResponse({ user: created });
    })
    .patch("/users/:id", async ({ request, params, body, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      const b = (body ?? {}) as Record<string, unknown>;
      if (params.id === session.user_id && b.disabled === true) {
        set.status = 400;
        return errorResponse("CANNOT_DELETE_SELF", "Cannot disable your own active account");
      }
      const patch: { role?: UserRole; disabled?: boolean; passwordHash?: string } = {};
      if (b.role !== undefined) {
        if (b.role !== "admin" && b.role !== "viewer") {
          set.status = 400;
          return errorResponse("VALIDATION_ERROR", "Role must be 'admin' or 'viewer'");
        }
        patch.role = b.role;
      }
      if (b.disabled !== undefined) {
        patch.disabled = Boolean(b.disabled);
      }
      if (typeof b.password === "string" && b.password.length > 0) {
        if (b.password.length < 10 || b.password.length > 128) {
          set.status = 400;
          return errorResponse(
            "VALIDATION_ERROR",
            "Password must be between 10 and 128 characters",
          );
        }
        patch.passwordHash = await authService.hashPassword(b.password);
      }
      const updated = authRepo.updateUser(params.id, patch);
      if (!updated) {
        set.status = 404;
        return errorResponse("USER_NOT_FOUND", `User '${params.id}' not found`);
      }
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "USER_UPDATE",
        targetType: "user",
        targetId: params.id,
        details: { role: patch.role, disabled: patch.disabled },
        ipAddress: clientIp(request),
      });
      return okResponse({ user: updated });
    })
    .delete("/users/:id", ({ request, params, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      if (params.id === session.user_id) {
        set.status = 400;
        return errorResponse("CANNOT_DELETE_SELF", "Cannot delete your own active account");
      }
      if (!authRepo.deleteUser(params.id)) {
        set.status = 404;
        return errorResponse("USER_NOT_FOUND", `User '${params.id}' not found`);
      }
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "USER_DELETE",
        targetType: "user",
        targetId: params.id,
        ipAddress: clientIp(request),
      });
      return okResponse({ deleted: true });
    });
}
