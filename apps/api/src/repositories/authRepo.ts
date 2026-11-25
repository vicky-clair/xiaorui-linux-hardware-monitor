// 用户账户、会话令牌哈希、登录失败限流记录、系统配置与管理员审计日志（audit_logs）仓储。
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DatabaseHandle } from "./db.ts";
import {
  appSessions,
  appSettings,
  appUsers,
  auditLogs,
  loginAttempts,
} from "./schema.ts";

export type UserRole = "admin" | "viewer";

export interface PublicUser {
  user_id: string;
  username: string;
  role: UserRole;
  disabled: boolean;
  created_at: string;
  updated_at: string;
}

export class AuthRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  countUsers(): number {
    const row = this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(appUsers)
      .get();
    return row?.count ?? 0;
  }

  findUserByUsername(username: string) {
    return this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.username, username))
      .get();
  }

  findUserById(userId: string) {
    return this.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.userId, userId))
      .get();
  }

  listUsers(): PublicUser[] {
    return this.db
      .select()
      .from(appUsers)
      .all()
      .map((u) => ({
        user_id: u.userId,
        username: u.username,
        role: u.role as UserRole,
        disabled: u.disabled === 1,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
      }));
  }

  createUser(params: {
    userId: string;
    username: string;
    passwordHash: string;
    role: UserRole;
  }): PublicUser {
    const now = new Date().toISOString();
    this.db
      .insert(appUsers)
      .values({
        userId: params.userId,
        username: params.username,
        passwordHash: params.passwordHash,
        role: params.role,
        disabled: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return {
      user_id: params.userId,
      username: params.username,
      role: params.role,
      disabled: false,
      created_at: now,
      updated_at: now,
    };
  }

  updateUser(
    userId: string,
    patch: { role?: UserRole; disabled?: boolean; passwordHash?: string },
  ): PublicUser | null {
    const existing = this.findUserById(userId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .update(appUsers)
      .set({
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.disabled !== undefined
          ? { disabled: patch.disabled ? 1 : 0 }
          : {}),
        ...(patch.passwordHash !== undefined
          ? { passwordHash: patch.passwordHash }
          : {}),
        updatedAt: now,
      })
      .where(eq(appUsers.userId, userId))
      .run();
    const updated = this.findUserById(userId)!;
    return {
      user_id: updated.userId,
      username: updated.username,
      role: updated.role as UserRole,
      disabled: updated.disabled === 1,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    };
  }

  deleteUser(userId: string): boolean {
    const existing = this.findUserById(userId);
    if (!existing) return false;
    this.db.delete(appUsers).where(eq(appUsers.userId, userId)).run();
    return true;
  }

  createSession(params: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    ipAddress?: string;
    userAgent?: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .insert(appSessions)
      .values({
        sessionId: params.sessionId,
        userId: params.userId,
        tokenHash: params.tokenHash,
        createdAt: now,
        expiresAt: params.expiresAt,
        lastSeenAt: now,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      })
      .run();
  }

  findActiveSessionByTokenHash(tokenHash: string) {
    const now = new Date().toISOString();
    const row = this.db
      .select({
        sessionId: appSessions.sessionId,
        expiresAt: appSessions.expiresAt,
        userId: appUsers.userId,
        username: appUsers.username,
        role: appUsers.role,
        disabled: appUsers.disabled,
      })
      .from(appSessions)
      .innerJoin(appUsers, eq(appSessions.userId, appUsers.userId))
      .where(eq(appSessions.tokenHash, tokenHash))
      .get();

    if (!row || row.disabled === 1 || row.expiresAt <= now) {
      return null;
    }

    this.db
      .update(appSessions)
      .set({ lastSeenAt: now })
      .where(eq(appSessions.sessionId, row.sessionId))
      .run();

    return {
      session_id: row.sessionId,
      user_id: row.userId,
      username: row.username,
      role: row.role as UserRole,
    };
  }

  deleteSessionByTokenHash(tokenHash: string): void {
    this.db
      .delete(appSessions)
      .where(eq(appSessions.tokenHash, tokenHash))
      .run();
  }

  /** 吊销指定用户的全部活跃会话（改密或禁用账号时调用，防止旧 Cookie 继续生效） */
  deleteSessionsByUserId(userId: string): void {
    this.db
      .delete(appSessions)
      .where(eq(appSessions.userId, userId))
      .run();
  }

  recordLoginAttempt(username: string, ipAddress: string, succeeded: boolean): void {
    this.db
      .insert(loginAttempts)
      .values({
        username,
        ipAddress,
        succeeded: succeeded ? 1 : 0,
        attemptedAt: new Date().toISOString(),
      })
      .run();
  }

  countRecentFailedAttempts(
    username: string,
    ipAddress: string,
    windowMinutes: number = 15,
  ): number {
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const byUser = this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.username, username),
          eq(loginAttempts.succeeded, 0),
          gte(loginAttempts.attemptedAt, since),
        ),
      )
      .get();
    const byIp = this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ipAddress, ipAddress),
          eq(loginAttempts.succeeded, 0),
          gte(loginAttempts.attemptedAt, since),
        ),
      )
      .get();
    return Math.max(byUser?.count ?? 0, byIp?.count ?? 0);
  }

  // ---- Settings (never returns sensitive values to frontend) ----

  getPublicSettings(): Record<string, unknown> {
    const rows = this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.isSensitive, 0))
      .all();
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      out[r.key] = JSON.parse(r.valueJson);
    }
    return out;
  }

  /** Server-internal lookup (may read sensitive keys; never expose raw result to clients). */
  getInternalSetting(key: string): { value: unknown; isSensitive: boolean } | null {
    const row = this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .get();
    if (!row) return null;
    return {
      value: JSON.parse(row.valueJson),
      isSensitive: row.isSensitive === 1,
    };
  }

  upsertSettings(
    updates: Record<string, unknown>,
    actorUsername: string,
    sensitiveKeys: Set<string> = new Set(),
  ): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        // 强制保护包含 secret/token/password 的配置键始终以 is_sensitive=1 存储，防止通过通用配置接口误降级泄露
        const isSensitive =
          sensitiveKeys.has(key) || /secret|token|password/i.test(key) ? 1 : 0;
        this.db
          .insert(appSettings)
          .values({
            key,
            valueJson: JSON.stringify(value),
            isSensitive,
            updatedAt: now,
            updatedBy: actorUsername,
          })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: {
              valueJson: JSON.stringify(value),
              isSensitive,
              updatedAt: now,
              updatedBy: actorUsername,
            },
          })
          .run();
      }
    });
    tx();
  }

  writeAuditLog(entry: {
    actorUserId?: string | null;
    actorUsername: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  }): void {
    this.db
      .insert(auditLogs)
      .values({
        actorUserId: entry.actorUserId ?? null,
        actorUsername: entry.actorUsername,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        detailsJson: entry.details ? JSON.stringify(entry.details) : null,
        ipAddress: entry.ipAddress ?? null,
        occurredAt: new Date().toISOString(),
      })
      .run();
  }

  listAuditLogs(limit: number = 100) {
    return this.db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(Math.min(limit, 500))
      .all();
  }
}
