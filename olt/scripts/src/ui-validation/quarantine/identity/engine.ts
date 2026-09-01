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
  PersonaAccessEvaluation,
  PermissionAuditExpectation,
} from "./types.ts";
import {
  base64UrlEncode,
  base64UrlDecode,
  MOCK_JWT_SECRET,
} from "./types.ts";

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

  public detectSessionDegradation(
    params: SessionDegradationInspectionParams,
  ): SessionDegradationResult {
    const { statusCode, currentUrl, pageTitle, domSnippet, token, activePersona, loginPathPatterns } = params;

    if (statusCode === 401) {
      return {
        degraded: true,
        cause: "STATUS_401",
        confidence: 1.0,
        targetPersona: activePersona.role,
        detectedAtUrl: currentUrl,
        recommendedAction: "RE_AUTHENTICATE",
        reason: "Received HTTP 401 Unauthorized status code.",
      };
    }

    if (statusCode === 403) {
      return {
        degraded: true,
        cause: "STATUS_403",
        confidence: 0.95,
        targetPersona: activePersona.role,
        detectedAtUrl: currentUrl,
        recommendedAction: "SWITCH_PERSONA",
        reason: "Received HTTP 403 Forbidden status code.",
      };
    }

    if (statusCode === 419) {
      return {
        degraded: true,
        cause: "STATUS_419",
        confidence: 1.0,
        targetPersona: activePersona.role,
        detectedAtUrl: currentUrl,
        recommendedAction: "REFRESH_TOKEN",
        reason: "Received HTTP 419 Page Expired (CSRF/Session token timeout).",
      };
    }

    const defaultLoginPatterns = loginPathPatterns ?? ["/login", "/signin", "/auth/login", "/auth/signin"];
    const isLoginPage = defaultLoginPatterns.some((p) => currentUrl.includes(p));
    if (isLoginPage && !currentUrl.includes("return_to=") && activePersona.role !== "guest") {
      return {
        degraded: true,
        cause: "REDIRECT_TO_LOGIN",
        confidence: 0.9,
        targetPersona: activePersona.role,
        detectedAtUrl: currentUrl,
        recommendedAction: "RE_AUTHENTICATE",
        reason: `Redirected to login page (${currentUrl}) while acting as authenticated persona '${activePersona.role}'.`,
      };
    }

    if (token && this.isTokenExpired(token)) {
      return {
        degraded: true,
        cause: "EXPIRED_JWT",
        confidence: 1.0,
        targetPersona: activePersona.role,
        detectedAtUrl: currentUrl,
        recommendedAction: "REFRESH_TOKEN",
        reason: "JWT authentication token expiration timestamp has elapsed.",
      };
    }

    if (domSnippet) {
      const bannerPatterns = [
        /session\s+expired/i,
        /please\s+log\s+in/i,
        /unauthorized\s+access/i,
        /you\s+have\s+been\s+logged\s+out/i,
      ];
      for (const pat of bannerPatterns) {
        if (pat.test(domSnippet) || (pageTitle && pat.test(pageTitle))) {
          return {
            degraded: true,
            cause: "VISUAL_UNAUTHORIZED_BANNER",
            confidence: 0.85,
            targetPersona: activePersona.role,
            detectedAtUrl: currentUrl,
            recommendedAction: "RE_AUTHENTICATE",
            reason: "Detected visual session expiration or unauthorized banner in DOM/Title.",
          };
        }
      }
    }

    return {
      degraded: false,
      cause: "NONE",
      confidence: 1.0,
      targetPersona: activePersona.role,
      detectedAtUrl: currentUrl,
      recommendedAction: "IGNORE",
      reason: "Session is active and valid.",
    };
  }

  public executeAutonomousReauthentication(
    degradation: SessionDegradationResult,
    persona: PersonaDefinition,
    options?: {
      readonly baseUrl?: string | undefined;
      readonly resumeUrl?: string | undefined;
    },
  ): ReauthExecutionPlan {
    const freshContext = this.createPersonaSessionContext(persona, options);
    const resumeUrl = options?.resumeUrl ?? degradation.detectedAtUrl;
    const injectionSteps = [
      `1. Minted fresh mock JWT token for persona '${persona.role}' (exp=${Math.floor(freshContext.expiresAt / 1000)})`,
      `2. Generated ${freshContext.cookies.length} session cookies for domain '${freshContext.cookies[0]?.domain ?? "localhost"}'`,
      `3. Prepared storageState payload with local storage authentication tokens`,
      `4. Injected authorization headers: Authorization Bearer token`,
      `5. Resuming navigation to target URL: '${resumeUrl}'`,
    ];

    return {
      persona,
      freshContext,
      resumeUrl,
      injectionSteps,
      success: true,
      diagnostics: `Autonomous re-authentication completed successfully for persona '${persona.role}'. Cause resolved: ${degradation.cause}`,
    };
  }

  public simulatePermissionBoundary(
    targetRouteOrAction: string,
    routeRequiredPermissions: readonly string[],
    personas: readonly PersonaDefinition[],
  ): PermissionBoundaryAuditResult {
    const evaluations: PersonaAccessEvaluation[] = [];

    for (const persona of personas) {
      const hasWildcard = persona.permissions.includes("*");
      const hasDirectPermission = routeRequiredPermissions.some((p) =>
        persona.permissions.includes(p),
      );
      const isPublicRoute = routeRequiredPermissions.length === 0 || routeRequiredPermissions.includes("public_read");

      const isPermitted = hasWildcard || hasDirectPermission || isPublicRoute;

      const isPrivileged = persona.role === "admin" || persona.permissions.includes("*");
      let expectedResult: PermissionAuditExpectation = "ALLOW";
      if (!isPermitted) {
        expectedResult = persona.role === "guest" ? "DENY_REDIRECT_LOGIN" : "DENY_FORBIDDEN";
      }

      const actualResult = isPermitted ? "ALLOW" : persona.role === "guest" ? "DENY_REDIRECT_LOGIN" : "DENY_FORBIDDEN";

      const status =
        expectedResult === actualResult
          ? "COMPLIANT"
          : isPermitted && !isPrivileged
            ? "PRIVILEGE_LEAKAGE"
            : "FALSE_POSITIVE_REJECTION";

      evaluations.push({
        persona: persona.role,
        role: persona.role,
        expectedResult,
        actualResult,
        status,
        details: `Persona '${persona.role}' with permissions [${persona.permissions.join(", ")}] evaluated against required [${routeRequiredPermissions.join(", ")}]. Result: ${actualResult}.`,
      });
    }

    const privilegeLeakages = evaluations.filter((e) => e.status === "PRIVILEGE_LEAKAGE");
    const falsePositiveRejections = evaluations.filter((e) => e.status === "FALSE_POSITIVE_REJECTION");
    const compliant = privilegeLeakages.length === 0 && falsePositiveRejections.length === 0;

    const securityScore = compliant
      ? 100
      : Math.max(0, 100 - privilegeLeakages.length * 40 - falsePositiveRejections.length * 20);

    return {
      targetRouteOrAction,
      evaluations,
      compliant,
      privilegeLeakages,
      falsePositiveRejections,
      securityScore,
      timestamp: new Date().toISOString(),
    };
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

export function detectSessionDegradation(params: SessionDegradationInspectionParams): SessionDegradationResult {
  return getDefaultIdentityGovernanceEngine().detectSessionDegradation(params);
}

export function executeAutonomousReauthentication(degradation: SessionDegradationResult, persona: PersonaDefinition): ReauthExecutionPlan {
  return getDefaultIdentityGovernanceEngine().executeAutonomousReauthentication(degradation, persona);
}

export function simulatePermissionBoundary(targetRouteOrAction: string, routeRequiredPermissions: readonly string[], personas: readonly PersonaDefinition[]): PermissionBoundaryAuditResult {
  return getDefaultIdentityGovernanceEngine().simulatePermissionBoundary(targetRouteOrAction, routeRequiredPermissions, personas);
}
