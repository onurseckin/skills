import type { CaptureAuthConfig, CaptureConfig, CaptureUserConfig } from "../config/types.ts";
import type { CapturePageDriver, ResolvedSessionAuth } from "./types.ts";

export const CANONICAL_ROLES: readonly string[] = ["admin", "driver", "customer", "custom"];

export class SessionAuthResolver {
  private readonly authConfig: CaptureAuthConfig | undefined;
  private readonly cache: Map<string, ResolvedSessionAuth> = new Map();

  constructor(config?: CaptureAuthConfig | CaptureConfig) {
    if (!config) {
      this.authConfig = undefined;
    } else if ("users" in config && typeof config.users === "object") {
      this.authConfig = config as CaptureAuthConfig;
    } else if ("auth" in config && config.auth) {
      this.authConfig = config.auth;
    } else {
      this.authConfig = undefined;
    }
  }

  public getAuthConfig(): CaptureAuthConfig | undefined {
    return this.authConfig;
  }

  public getAllRoles(): readonly string[] {
    const roles = new Set<string>(CANONICAL_ROLES);
    if (this.authConfig?.users) {
      for (const user of Object.values(this.authConfig.users)) {
        if (user.role) roles.add(user.role);
        if (user.id) roles.add(user.id);
      }
    }
    return Array.from(roles);
  }

  public getCachedSession(roleOrKey: string): ResolvedSessionAuth | null {
    return this.cache.get(roleOrKey.toLowerCase()) ?? null;
  }

  public cacheSession(roleOrKey: string, session: ResolvedSessionAuth): void {
    this.cache.set(roleOrKey.toLowerCase(), session);
    if (session.role) {
      this.cache.set(session.role.toLowerCase(), session);
    }
    if (session.userId) {
      this.cache.set(session.userId.toLowerCase(), session);
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public resolveRole(roleName: string): ResolvedSessionAuth | null {
    const normalized = roleName.trim().toLowerCase();
    const cached = this.getCachedSession(normalized);
    if (cached) return cached;

    if (!this.authConfig || !this.authConfig.users) {
      const simulated = this.createSimulatedSession(normalized, normalized);
      this.cacheSession(normalized, simulated);
      return simulated;
    }

    const matchedUser = this.findUserByRoleOrId(normalized);
    if (matchedUser) {
      const session = this.buildSessionFromUser(matchedUser);
      this.cacheSession(normalized, session);
      return session;
    }

    if (this.authConfig.defaultUser && this.authConfig.users[this.authConfig.defaultUser]) {
      const defaultUser = this.authConfig.users[this.authConfig.defaultUser];
      if (defaultUser) {
        const session = this.buildSessionFromUser(defaultUser);
        this.cacheSession(normalized, session);
        return session;
      }
    }

    const simulated = this.createSimulatedSession(normalized, normalized);
    this.cacheSession(normalized, simulated);
    return simulated;
  }

  public resolveUser(userId: string): ResolvedSessionAuth | null {
    const normalized = userId.trim().toLowerCase();
    const cached = this.getCachedSession(normalized);
    if (cached) return cached;

    if (!this.authConfig?.users) {
      const simulated = this.createSimulatedSession(normalized, "user");
      this.cacheSession(normalized, simulated);
      return simulated;
    }

    const user = this.authConfig.users[userId] ?? this.authConfig.users[normalized];
    if (user) {
      const session = this.buildSessionFromUser(user);
      this.cacheSession(normalized, session);
      return session;
    }

    return this.resolveRole(userId);
  }

  private findUserByRoleOrId(key: string): CaptureUserConfig | null {
    if (!this.authConfig?.users) return null;
    if (this.authConfig.users[key]) return this.authConfig.users[key];

    for (const [id, user] of Object.entries(this.authConfig.users)) {
      if (id.toLowerCase() === key || user.id.toLowerCase() === key) return user;
      if (user.role.toLowerCase() === key) return user;
    }
    return null;
  }

  private resolveTokenHeaderName(): string {
    if (this.authConfig?.tokenHeaderName) {
      return this.authConfig.tokenHeaderName;
    }
    return "Authorization";
  }

  private buildSessionFromUser(user: CaptureUserConfig): ResolvedSessionAuth {
    const tokenHeader = this.resolveTokenHeaderName();
    const headers: Record<string, string> = { ...user.headers };

    if (user.token) {
      const formattedToken =
        tokenHeader.toLowerCase() === "authorization" && !user.token.startsWith("Bearer ")
          ? `Bearer ${user.token}`
          : user.token;
      headers[tokenHeader] = formattedToken;
    }

    return {
      userId: user.id,
      role: user.role,
      name: user.name,
      ...(user.token !== undefined ? { token: user.token } : {}),
      headers,
      ...(user.cookies ? { cookies: user.cookies } : {}),
      resolvedAt: new Date().toISOString(),
    };
  }

  private createSimulatedSession(role: string, name: string): ResolvedSessionAuth {
    const tokenHeader = this.resolveTokenHeaderName();
    const token = `mock-token-${role}-${Date.now()}`;
    const headers: Record<string, string> = {
      [tokenHeader]: `Bearer ${token}`,
      "X-Mock-Auth-Role": role,
    };
    const cookies = [
      {
        name: "mock_session_id",
        value: `mock-cookie-${role}`,
        path: "/",
      },
    ];

    return {
      userId: role,
      role,
      name: `Simulated ${name}`,
      token,
      headers,
      cookies,
      resolvedAt: new Date().toISOString(),
    };
  }

  public applyAuthToHeaders(
    baseHeaders: Record<string, string>,
    session: ResolvedSessionAuth,
  ): Record<string, string> {
    return {
      ...baseHeaders,
      ...session.headers,
    };
  }

  public async applyAuthToDriver(
    driver: CapturePageDriver,
    session: ResolvedSessionAuth,
  ): Promise<void> {
    if (Object.keys(session.headers).length > 0) {
      await driver.setExtraHTTPHeaders({ ...session.headers });
    }
    if (session.cookies && session.cookies.length > 0) {
      if (driver.setCookies) {
        await driver.setCookies(session.cookies);
      } else if (driver.setCookie) {
        for (const cookie of session.cookies) {
          await driver.setCookie(cookie);
        }
      }
    }
  }
}

export function createSessionAuthResolver(
  config?: CaptureAuthConfig | CaptureConfig,
): SessionAuthResolver {
  return new SessionAuthResolver(config);
}
