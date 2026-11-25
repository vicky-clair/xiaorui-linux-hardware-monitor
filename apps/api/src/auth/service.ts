// 认证与权限服务：负责首次启动一次性引导令牌、Argon2id 密码校验、登录限流、SHA-256 会话 Cookie 与 RBAC 鉴权。
import { randomBytes } from "node:crypto";
import type { ApiConfig } from "../config/env.ts";
import type { AuthRepository, PublicUser, UserRole } from "../repositories/authRepo.ts";

export const SESSION_COOKIE_NAME = "lhm_session";
const MAX_FAILED_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MINUTES = 15;

export interface AuthSession {
  session_id: string;
  user_id: string;
  username: string;
  role: UserRole;
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function sha256Hex(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export class AuthService {
  private readonly bootstrapToken: string;

  constructor(
    private readonly repo: AuthRepository,
    private readonly config: ApiConfig,
  ) {
    this.bootstrapToken =
      config.bootstrapToken ?? randomBytes(24).toString("hex");
  }

  needsBootstrap(): boolean {
    return this.repo.countUsers() === 0;
  }

  getBootstrapTokenIfNeeded(): string | null {
    return this.needsBootstrap() ? this.bootstrapToken : null;
  }

  async hashPassword(password: string): Promise<string> {
    return Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 19_456, // 19 MiB (OWASP baseline, gentle on N5095A)
      timeCost: 2,
    });
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return Bun.password.verify(password, hash);
  }

  async bootstrapAdmin(params: {
    token: string;
    username: string;
    password: string;
    ipAddress: string;
  }): Promise<PublicUser> {
    if (!this.needsBootstrap()) {
      throw new AuthError(
        403,
        "BOOTSTRAP_ALREADY_COMPLETED",
        "Initial administrator has already been created",
      );
    }
    const recentBootstrapFailures = this.repo.countRecentFailedAttempts(
      "__bootstrap__",
      params.ipAddress,
      RATE_LIMIT_WINDOW_MINUTES,
    );
    if (recentBootstrapFailures >= MAX_FAILED_ATTEMPTS) {
      throw new AuthError(
        429,
        "TOO_MANY_ATTEMPTS",
        "Too many failed bootstrap attempts; please try again later",
      );
    }
    if (params.token !== this.bootstrapToken) {
      this.repo.recordLoginAttempt("__bootstrap__", params.ipAddress, false);
      throw new AuthError(
        403,
        "INVALID_BOOTSTRAP_TOKEN",
        "Invalid one-time bootstrap token",
      );
    }
    this.repo.recordLoginAttempt("__bootstrap__", params.ipAddress, true);
    this.validateUsernameAndPassword(params.username, params.password);
    const hash = await this.hashPassword(params.password);
    const user = this.repo.createUser({
      userId: `usr-${crypto.randomUUID()}`,
      username: params.username.trim(),
      passwordHash: hash,
      role: "admin",
    });
    this.repo.writeAuditLog({
      actorUserId: user.user_id,
      actorUsername: user.username,
      action: "AUTH_BOOTSTRAP_ADMIN",
      targetType: "user",
      targetId: user.user_id,
      ipAddress: params.ipAddress,
    });
    return user;
  }

  async login(params: {
    username: string;
    password: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<{ user: PublicUser; sessionToken: string; cookieHeader: string }> {
    const username = params.username.trim();
    const recentFailures = this.repo.countRecentFailedAttempts(
      username,
      params.ipAddress,
      RATE_LIMIT_WINDOW_MINUTES,
    );
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw new AuthError(
        429,
        "TOO_MANY_ATTEMPTS",
        "Too many failed login attempts; please try again later",
      );
    }

    const user = this.repo.findUserByUsername(username);
    const ok =
      user !== undefined &&
      user.disabled === 0 &&
      (await this.verifyPassword(params.password, user.passwordHash));

    this.repo.recordLoginAttempt(username, params.ipAddress, ok);

    if (!ok || !user) {
      throw new AuthError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid username or password",
      );
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(
      Date.now() + this.config.sessionTtlSeconds * 1000,
    ).toISOString();

    this.repo.createSession({
      sessionId: `ses-${crypto.randomUUID()}`,
      userId: user.userId,
      tokenHash,
      expiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    this.repo.writeAuditLog({
      actorUserId: user.userId,
      actorUsername: user.username,
      action: "AUTH_LOGIN",
      targetType: "session",
      ipAddress: params.ipAddress,
    });

    return {
      user: {
        user_id: user.userId,
        username: user.username,
        role: user.role as UserRole,
        disabled: user.disabled === 1,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
      sessionToken: rawToken,
      cookieHeader: this.buildSessionCookie(rawToken),
    };
  }

  logout(rawToken: string | undefined, session: AuthSession | null, ipAddress: string): string {
    if (rawToken) {
      this.repo.deleteSessionByTokenHash(sha256Hex(rawToken));
    }
    if (session) {
      this.repo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "AUTH_LOGOUT",
        targetType: "session",
        targetId: session.session_id,
        ipAddress,
      });
    }
    return this.buildClearCookie();
  }

  authenticateRequest(request: Request): AuthSession | null {
    const cookies = parseCookies(request.headers.get("cookie"));
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;
    return this.repo.findActiveSessionByTokenHash(sha256Hex(token));
  }

  isOriginAllowed(origin: string | null): boolean {
    if (!origin) return true; // non-browser / same-origin clients without Origin header
    return this.config.allowedOrigins.includes(origin);
  }

  buildSessionCookie(rawToken: string): string {
    const parts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${this.config.sessionTtlSeconds}`,
    ];
    if (this.config.cookieSecure) {
      parts.push("Secure");
    }
    return parts.join("; ");
  }

  buildClearCookie(): string {
    const parts = [
      `${SESSION_COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ];
    if (this.config.cookieSecure) {
      parts.push("Secure");
    }
    return parts.join("; ");
  }

  validateUsernameAndPassword(username: string, password: string): void {
    const trimmed = username.trim();
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(trimmed)) {
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Username must be 3–64 characters matching [a-zA-Z0-9._-]",
      );
    }
    if (password.length < 10 || password.length > 128) {
      throw new AuthError(
        400,
        "VALIDATION_ERROR",
        "Password must be between 10 and 128 characters",
      );
    }
  }
}
