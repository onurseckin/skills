import type { CookieTemplateSpec, PersonaDefinition } from "../parameters/index.ts";

import { createHmac } from "node:crypto";

/**
 * Session and Storage State Types
 */
export interface SessionCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "Strict" | "Lax" | "None";
}

export interface LocalStorageEntry {
  readonly name: string;
  readonly value: string;
}

export interface BrowserStorageOrigin {
  readonly origin: string;
  readonly localStorage: readonly LocalStorageEntry[];
}

export interface BrowserStorageState {
  readonly cookies: readonly SessionCookie[];
  readonly origins: readonly BrowserStorageOrigin[];
}

export interface PersonaSessionContext {
  readonly persona: PersonaDefinition;
  readonly token: string;
  readonly cookies: readonly SessionCookie[];
  readonly authHeaders: Record<string, string>;
  readonly storageState: BrowserStorageState;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/**
 * Degradation Detection Types
 */
export type SessionDegradationCause =
  | "STATUS_401"
  | "STATUS_403"
  | "STATUS_419"
  | "REDIRECT_TO_LOGIN"
  | "VISUAL_UNAUTHORIZED_BANNER"
  | "EXPIRED_JWT"
  | "NONE";

export interface SessionDegradationInspectionParams {
  readonly currentUrl: string;
  readonly statusCode?: number | undefined;
  readonly responseHeaders?: Record<string, string> | undefined;
  readonly pageTitle?: string | undefined;
  readonly domSnippet?: string | undefined;
  readonly currentStorageState?: BrowserStorageState | undefined;
  readonly activePersona: PersonaDefinition;
  readonly token?: string | undefined;
  readonly loginPathPatterns?: readonly string[] | undefined;
}

export interface SessionDegradationResult {
  readonly degraded: boolean;
  readonly cause: SessionDegradationCause;
  readonly confidence: number;
  readonly targetPersona: string;
  readonly detectedAtUrl: string;
  readonly recommendedAction: "RE_AUTHENTICATE" | "REFRESH_TOKEN" | "SWITCH_PERSONA" | "IGNORE";
  readonly reason: string;
}

/**
 * Re-authentication Execution Plan
 */
export interface ReauthExecutionPlan {
  readonly persona: PersonaDefinition;
  readonly freshContext: PersonaSessionContext;
  readonly resumeUrl: string;
  readonly injectionSteps: readonly string[];
  readonly success: boolean;
  readonly diagnostics: string;
}

/**
 * Permission Boundary Simulation Types
 */
export type PermissionAuditExpectation =
  | "ALLOW"
  | "DENY_FORBIDDEN"
  | "DENY_REDIRECT_LOGIN"
  | "READ_ONLY";

export interface PersonaAccessEvaluation {
  readonly persona: string;
  readonly role: string;
  readonly expectedResult: PermissionAuditExpectation;
  readonly actualResult: "ALLOW" | "DENY_FORBIDDEN" | "DENY_REDIRECT_LOGIN" | "READ_ONLY";
  readonly status: "COMPLIANT" | "PRIVILEGE_LEAKAGE" | "FALSE_POSITIVE_REJECTION";
  readonly details: string;
}

export interface PermissionBoundaryAuditResult {
  readonly targetRouteOrAction: string;
  readonly evaluations: readonly PersonaAccessEvaluation[];
  readonly compliant: boolean;
  readonly privilegeLeakages: readonly PersonaAccessEvaluation[];
  readonly falsePositiveRejections: readonly PersonaAccessEvaluation[];
  readonly securityScore: number;
  readonly timestamp: string;
}

/**
 * Base64 URL Encoding Helpers
 */
export function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/gu, "+").replace(/_/gu, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

export const MOCK_JWT_SECRET = "olt-test-mock-jwt-secret-key-32-chars-long";

/**
 * Declarative Identity Governance Engine
 */
