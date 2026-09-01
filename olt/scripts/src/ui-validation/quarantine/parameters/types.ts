export type { RepoPolicy } from "../../../policy/index.ts";

/**
 * Deductive Parameter Structures
 */
export interface ApplicationEndpoints {
  readonly baseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly healthEndpoint: string;
  readonly readyTimeoutMs: number;
  readonly loginUrl: string;
  readonly logoutUrl: string;
  readonly signupUrl?: string | undefined;
  readonly sessionVerifyUrl: string;
  readonly publicRoutes: readonly string[];
  readonly authenticatedRoutes: readonly string[];
  readonly apiBaseUrl: string;
}

export interface RunningPortInfo {
  readonly port: number;
  readonly host: string;
  readonly protocol: "http" | "https";
  readonly containerName?: string | undefined;
  readonly composeFile?: string | undefined;
  readonly healthEndpoint?: string | undefined;
}

export interface CookieTemplateSpec {
  readonly name: string;
  readonly domain: string;
  readonly path: string;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "Strict" | "Lax" | "None";
}

export interface PersonaDefinition {
  readonly role: string;
  readonly email: string;
  readonly passwordEnvVar: string;
  readonly displayName: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
  readonly mockSessionCookie?: string | undefined;
  readonly cookieTemplate?: CookieTemplateSpec | undefined;
}

export interface FeatureScope {
  readonly name: string;
  readonly pathPrefix: string;
  readonly requiredPermissions: readonly string[];
  readonly accessiblePersonas: readonly string[];
}

export interface DeductiveParameters {
  readonly endpoints: ApplicationEndpoints;
  readonly portInfo: RunningPortInfo;
  readonly personas: Record<string, PersonaDefinition>;
  readonly featureScopes: readonly FeatureScope[];
  readonly provenance: "explicit_policy" | "auto_detected" | "canonical_default";
  readonly extractedAt: string;
}

export interface ExtractionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly parameters: DeductiveParameters;
}

/**
 * Canonical default personas for synthetic testing
 */
export const CANONICAL_DEFAULT_PERSONAS: Record<string, PersonaDefinition> = {
  admin: {
    role: "admin",
    email: "admin@olt.local",
    passwordEnvVar: "OLT_TEST_ADMIN_PASSWORD",
    displayName: "Test Administrator",
    tenantId: "tenant-corp-001",
    permissions: ["*"],
    mockSessionCookie: "olt_session_admin_mock_token_sec991823",
    cookieTemplate: {
      name: "olt_session_id",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  },
  standard_user: {
    role: "standard_user",
    email: "user@olt.local",
    passwordEnvVar: "OLT_TEST_USER_PASSWORD",
    displayName: "Standard User",
    tenantId: "tenant-corp-001",
    permissions: ["read", "write"],
    mockSessionCookie: "olt_session_user_mock_token_usr102938",
    cookieTemplate: {
      name: "olt_session_id",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  },
  compliance_auditor: {
    role: "compliance_auditor",
    email: "auditor@olt.local",
    passwordEnvVar: "OLT_TEST_AUDITOR_PASSWORD",
    displayName: "Compliance Auditor",
    tenantId: "tenant-corp-001",
    permissions: ["audit_read", "compliance_read", "report_export"],
    mockSessionCookie: "olt_session_auditor_mock_token_aud552109",
    cookieTemplate: {
      name: "olt_session_id",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  },
  billing_admin: {
    role: "billing_admin",
    email: "billing@olt.local",
    passwordEnvVar: "OLT_TEST_BILLING_PASSWORD",
    displayName: "Billing Administrator",
    tenantId: "tenant-corp-001",
    permissions: ["billing_read", "billing_write", "invoices_manage"],
    mockSessionCookie: "olt_session_billing_mock_token_bil773344",
    cookieTemplate: {
      name: "olt_session_id",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  },
  guest: {
    role: "guest",
    email: "guest@olt.local",
    passwordEnvVar: "OLT_TEST_GUEST_PASSWORD",
    displayName: "Guest Visitor",
    tenantId: "tenant-corp-001",
    permissions: ["public_read"],
  },
  invited_member: {
    role: "invited_member",
    email: "invited@olt.local",
    passwordEnvVar: "OLT_TEST_INVITED_PASSWORD",
    displayName: "Invited Member",
    tenantId: "tenant-corp-001",
    permissions: ["read"],
    mockSessionCookie: "olt_session_invited_mock_token_inv482019",
    cookieTemplate: {
      name: "olt_session_id",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  },
};

/**
 * Canonical default feature scopes
 */
export const CANONICAL_FEATURE_SCOPES: readonly FeatureScope[] = [
  {
    name: "authentication",
    pathPrefix: "/login",
    requiredPermissions: ["public_read"],
    accessiblePersonas: [
      "admin",
      "standard_user",
      "guest",
      "compliance_auditor",
      "billing_admin",
      "invited_member",
    ],
  },
  {
    name: "dashboard",
    pathPrefix: "/dashboard",
    requiredPermissions: ["read"],
    accessiblePersonas: [
      "admin",
      "standard_user",
      "compliance_auditor",
      "billing_admin",
      "invited_member",
    ],
  },
  {
    name: "administration",
    pathPrefix: "/admin",
    requiredPermissions: ["*"],
    accessiblePersonas: ["admin"],
  },
  {
    name: "billing",
    pathPrefix: "/billing",
    requiredPermissions: ["billing_read"],
    accessiblePersonas: ["admin", "billing_admin"],
  },
  {
    name: "compliance_audit",
    pathPrefix: "/audit",
    requiredPermissions: ["audit_read"],
    accessiblePersonas: ["admin", "compliance_auditor"],
  },
  {
    name: "profile_settings",
    pathPrefix: "/settings",
    requiredPermissions: ["read"],
    accessiblePersonas: [
      "admin",
      "standard_user",
      "compliance_auditor",
      "billing_admin",
      "invited_member",
    ],
  },
];

/**
 * Canonical default public and authenticated routes
 */
export const CANONICAL_PUBLIC_ROUTES: readonly string[] = [
  "/",
  "/login",
  "/signup",
  "/logout",
  "/about",
  "/help",
  "/terms",
  "/privacy",
];

export const CANONICAL_AUTHENTICATED_ROUTES: readonly string[] = [
  "/dashboard",
  "/settings",
  "/profile",
  "/admin",
  "/admin/users",
  "/admin/audit-logs",
  "/billing",
  "/billing/invoices",
  "/audit",
  "/reports",
  "/analytics",
];

/**
 * Deductive Parameter Extractor
 */
