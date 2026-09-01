import { createHmac } from "node:crypto";
import type { CookieTemplateSpec, PersonaDefinition } from "../parameters/index.ts";
import type {
  SessionCookie,
  LocalStorageEntry,
  BrowserStorageOrigin,
  BrowserStorageState,
  PersonaSessionContext,
  SessionDegradationInspectionParams,
  SessionDegradationResult,
  ReauthExecutionPlan,
  PermissionBoundaryAuditResult,
} from "./types.ts";
import {
  base64UrlEncode,
  base64UrlDecode,
  MOCK_JWT_SECRET,
} from "./tokens.ts";
import {
  detectSessionDegradation,
  executeAutonomousReauthentication,
} from "./session.ts";
import {
  simulatePermissionBoundary,
} from "./permissions.ts";

export class IdentityGovernanceEngine {
  public generateMockToken(
    persona: PersonaDefinition,
    options?: {
      readonly expiresInSeconds?: number | undefined;
      readonly customClaims?: Record<string, unknown> | undefined;
    },
  ): string {
    const header = {
      alg: "HS256",
      typ: "JWT",
    };

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttl = options?.expiresInSeconds ?? 3600; // 1 hour default
    const exp = nowSeconds + ttl;

    const payload: Record<string, unknown> = {
      sub: `user-${persona.role}-${persona.tenantId}`,
      email: persona.email,
      role: persona.role,
      displayName: persona.displayName,
      tenant_id: persona.tenantId,
      permissions: persona.permissions,
      iat: nowSeconds,
      exp,
      iss: "olt-identity-governor",
      ...(options?.customClaims ?? {}),
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac("sha256", MOCK_JWT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Decode and inspect a mock JWT token
   */
  public decodeMockToken(token: string): {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signature: string;
  } | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return null;
      }
      const headerRaw = base64UrlDecode(parts[0] ?? "");
      const payloadRaw = base64UrlDecode(parts[1] ?? "");
      return {
        header: JSON.parse(headerRaw) as Record<string, unknown>,
        payload: JSON.parse(payloadRaw) as Record<string, unknown>,
        signature: parts[2] ?? "",
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if a JWT token is expired
   */
  public isTokenExpired(token: string, currentTimestampSeconds?: number): boolean {
    const decoded = this.decodeMockToken(token);
    if (!decoded || typeof decoded.payload.exp !== "number") {
      return true;
    }
    const current = currentTimestampSeconds ?? Math.floor(Date.now() / 1000);
    return decoded.payload.exp <= current;
  }

  /**
   * Generate session cookies according to persona and template
   */
  public generateSessionCookies(
    persona: PersonaDefinition,
    options?: {
      readonly baseUrl?: string | undefined;
      readonly token?: string | undefined;
      readonly expiresInSeconds?: number | undefined;
    },
  ): SessionCookie[] {
    const token = options?.token ?? this.generateMockToken(persona, options);
    const template: CookieTemplateSpec = persona.cookieTemplate ?? {
      name: "olt_session_id",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    };

    const host = options?.baseUrl ? new URL(options.baseUrl).hostname : template.domain;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttl = options?.expiresInSeconds ?? 3600;
    const expires = nowSeconds + ttl;

    const cookieValue = persona.mockSessionCookie ?? token;

    const sessionCookie: SessionCookie = {
      name: template.name,
      value: cookieValue,
      domain: host,
      path: template.path,
      expires,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
    };

    const userTokenCookie: SessionCookie = {
      name: "olt_jwt_token",
      value: token,
      domain: host,
      path: "/",
      expires,
      httpOnly: false,
      secure: template.secure,
      sameSite: template.sameSite,
    };

    return [sessionCookie, userTokenCookie];
  }

  /**
   * Generate Playwright-compatible browser storage state
   */
  public generateStorageState(
    persona: PersonaDefinition,
    options?: {
      readonly baseUrl?: string | undefined;
      readonly token?: string | undefined;
      readonly expiresInSeconds?: number | undefined;
    },
  ): BrowserStorageState {
    const baseUrl = options?.baseUrl ?? "http://localhost:3000";
    const origin = new URL(baseUrl).origin;
    const token = options?.token ?? this.generateMockToken(persona, options);
    const cookies = this.generateSessionCookies(persona, { ...options, token, baseUrl });

    const localStorageEntries: LocalStorageEntry[] = [
      { name: "auth_token", value: token },
      { name: "token_type", value: "Bearer" },
      {
        name: "current_user",
        value: JSON.stringify({
          role: persona.role,
          email: persona.email,
          displayName: persona.displayName,
          tenantId: persona.tenantId,
          permissions: persona.permissions,
        }),
      },
      { name: "tenant_id", value: persona.tenantId },
    ];

    return {
      cookies,
      origins: [
        {
          origin,
          localStorage: localStorageEntries,
        },
      ],
    };
  }

  /**
   * Generate standard HTTP Authorization headers
   */
  public generateAuthHeaders(
    persona: PersonaDefinition,
    token?: string,
  ): Record<string, string> {
    const authToken = token ?? this.generateMockToken(persona);
    return {
      Authorization: `Bearer ${authToken}`,
      "X-Tenant-ID": persona.tenantId,
      "X-User-Role": persona.role,
      "X-User-Email": persona.email,
    };
  }

  /**
   * Create complete persona session context
   */
  public createPersonaSessionContext(
    persona: PersonaDefinition,
    options?: {
      readonly baseUrl?: string | undefined;
      readonly expiresInSeconds?: number | undefined;
    },
  ): PersonaSessionContext {
    const token = this.generateMockToken(persona, options);
    const cookies = this.generateSessionCookies(persona, { ...options, token });
    const authHeaders = this.generateAuthHeaders(persona, token);
    const storageState = this.generateStorageState(persona, { ...options, token });
    const now = Date.now();
    const expiresAt = now + (options?.expiresInSeconds ?? 3600) * 1000;

    return {
      persona,
      token,
      cookies,
      authHeaders,
      storageState,
      createdAt: now,
      expiresAt,
    };
  }

  /**
   * Inspect in-flight state and detect mid-flight session degradation
   */
  public detectSessionDegradation(
    params: SessionDegradationInspectionParams,
  ): SessionDegradationResult {
    return detectSessionDegradation.call(this, params);
  }

  public executeAutonomousReauthentication(
    degradation: SessionDegradationResult,
    persona: PersonaDefinition,
    options?: {
      readonly baseUrl?: string | undefined;
      readonly resumeUrl?: string | undefined;
    },
  ): ReauthExecutionPlan {
    return executeAutonomousReauthentication.call(this, degradation, persona, options);
  }

  public simulatePermissionBoundary(
    targetRouteOrAction: string,
    routeRequiredPermissions: readonly string[],
    personas: readonly PersonaDefinition[],
  ): PermissionBoundaryAuditResult {
    return simulatePermissionBoundary(targetRouteOrAction, routeRequiredPermissions, personas);
  }
}

let defaultIdentityEngine: IdentityGovernanceEngine | null = null;

export function getDefaultIdentityGovernanceEngine(): IdentityGovernanceEngine {
  if (!defaultIdentityEngine) {
    defaultIdentityEngine = new IdentityGovernanceEngine();
  }
  return defaultIdentityEngine;
}

export function setDefaultIdentityGovernanceEngine(engine: IdentityGovernanceEngine): void {
  defaultIdentityEngine = engine;
}

export function resetDefaultIdentityGovernanceEngine(): void {
  defaultIdentityEngine = null;
}
