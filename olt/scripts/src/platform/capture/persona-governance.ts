import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/index.ts";
import { generateCanonicalDefaultPolicy, loadRepoPolicy } from "../../policy/index.ts";
import type {
  CaptureAuthConfig,
  CaptureCookie,
  CaptureUserConfig,
  CookieTemplateConfig,
  PersonaGovernanceRecord,
  PersonaGovernanceSyncResult,
  RepoPolicy,
  UserPersonaConfig,
  UserPersonaRole,
} from "./types.ts";

export const MANDATORY_PERSONA_ROLES: readonly UserPersonaRole[] = [
  "admin",
  "standard_user",
  "invited_member",
  "guest",
] as const;

export const DEFAULT_COOKIE_TEMPLATE: CookieTemplateConfig = {
  name: "olt_session_id",
  domain: "localhost",
  path: "/",
  http_only: true,
  secure: false,
  same_site: "Lax",
};

export function isUserPersonaRole(role: unknown): role is UserPersonaRole {
  return typeof role === "string" && (MANDATORY_PERSONA_ROLES as readonly string[]).includes(role);
}

function resolveRepoRoot(): string {
  return findRepoRoot();
}

function getFallbackDefaultPersonas(): Record<UserPersonaRole, UserPersonaConfig> {
  const defaultPolicy = generateCanonicalDefaultPolicy(resolveRepoRoot());
  const dockerEnv = defaultPolicy.docker_environment;
  if (dockerEnv !== undefined && dockerEnv.test_user_personas !== undefined) {
    return dockerEnv.test_user_personas;
  }
  return {
    admin: {
      role: "admin",
      email: "admin@olt.local",
      password_env_var: "OLT_TEST_ADMIN_PASSWORD",
      display_name: "Test Admin",
      tenant_id: "tenant-corp-001",
      permissions: ["*"],
    },
    standard_user: {
      role: "standard_user",
      email: "user@olt.local",
      password_env_var: "OLT_TEST_USER_PASSWORD",
      display_name: "Standard User",
      tenant_id: "tenant-corp-001",
      permissions: ["read", "write"],
    },
    invited_member: {
      role: "invited_member",
      email: "invited@olt.local",
      password_env_var: "OLT_TEST_INVITED_PASSWORD",
      display_name: "Invited Member",
      tenant_id: "tenant-corp-001",
      permissions: ["read"],
    },
    guest: {
      role: "guest",
      email: "guest@olt.local",
      password_env_var: "OLT_TEST_GUEST_PASSWORD",
      display_name: "Guest Visitor",
      tenant_id: "tenant-corp-001",
      permissions: ["public_read"],
    },
  };
}

function resolveEffectivePolicy(policy?: RepoPolicy): RepoPolicy {
  if (policy !== undefined) {
    return policy;
  }
  return loadRepoPolicy();
}

export function getAllUserPersonas(
  policy?: RepoPolicy,
): Record<UserPersonaRole, UserPersonaConfig> {
  const resolved = resolveEffectivePolicy(policy);
  const dockerEnv = resolved.docker_environment;
  const personas = dockerEnv !== undefined ? dockerEnv.test_user_personas : undefined;
  if (personas !== undefined) {
    const defaults = getFallbackDefaultPersonas();
    return {
      admin: personas.admin !== undefined ? personas.admin : defaults.admin,
      standard_user:
        personas.standard_user !== undefined ? personas.standard_user : defaults.standard_user,
      invited_member:
        personas.invited_member !== undefined ? personas.invited_member : defaults.invited_member,
      guest: personas.guest !== undefined ? personas.guest : defaults.guest,
    };
  }
  return getFallbackDefaultPersonas();
}

export function getUserPersona(role: UserPersonaRole, policy?: RepoPolicy): UserPersonaConfig {
  if (!isUserPersonaRole(role)) {
    throw new HarnessError("NOT_FOUND", `User persona role '${String(role)}' not found`);
  }
  const personas = getAllUserPersonas(policy);
  const persona = personas[role];
  if (persona === undefined) {
    throw new HarnessError("NOT_FOUND", `User persona '${role}' not configured in policy`);
  }
  return persona;
}

export function mapPolicyPersonaToCaptureUser(
  persona: UserPersonaConfig,
  template: CookieTemplateConfig = DEFAULT_COOKIE_TEMPLATE,
): CaptureUserConfig {
  const cookieValue =
    persona.mock_session_cookie !== undefined
      ? persona.mock_session_cookie
      : `mock_sess_${persona.role}_${persona.tenant_id}`;

  const emailParts = persona.email.split("@");
  const firstPart = emailParts[0];
  const derivedUsername =
    firstPart !== undefined && firstPart.length > 0 ? firstPart : persona.role;

  return {
    id: persona.role,
    name: persona.display_name,
    role: persona.role,
    email: persona.email,
    username: derivedUsername,
    password: `mock_pw_${persona.role}`,
    token: `tok_persona_${persona.role}_${persona.tenant_id}`,
    cookies: [
      {
        name: template.name,
        value: cookieValue,
        domain: template.domain,
        path: template.path,
        httpOnly: template.http_only,
        secure: template.secure,
        sameSite: template.same_site,
      },
    ],
  };
}

export function extractCaptureAuthFromPolicy(policy: RepoPolicy): CaptureAuthConfig {
  const personas = getAllUserPersonas(policy);
  const dockerEnv = policy.docker_environment;
  const authPaths = dockerEnv !== undefined ? dockerEnv.auth_paths : undefined;
  const cookieTemplates = dockerEnv !== undefined ? dockerEnv.session_cookie_templates : undefined;

  let defaultTemplate = DEFAULT_COOKIE_TEMPLATE;
  if (cookieTemplates !== undefined) {
    if (cookieTemplates["default"] !== undefined) {
      defaultTemplate = cookieTemplates["default"];
    } else if (cookieTemplates["session"] !== undefined) {
      defaultTemplate = cookieTemplates["session"];
    }
  }

  const users: Record<string, CaptureUserConfig> = {};
  for (const role of MANDATORY_PERSONA_ROLES) {
    const persona = personas[role];
    users[role] = mapPolicyPersonaToCaptureUser(persona, defaultTemplate);
  }

  const resolvedLoginUrl = authPaths !== undefined ? authPaths.login_url : "/login";

  return {
    defaultUser: "standard_user",
    loginUrl: resolvedLoginUrl,
    usernameSelector: "input[type='email'], input[name='email'], input[name='username']",
    passwordSelector: "input[type='password'], input[name='password']",
    submitSelector: "button[type='submit'], input[type='submit']",
    tokenHeaderName: "Authorization",
    users,
  };
}

export function generateMockSessionCookies(
  personas: Record<UserPersonaRole, UserPersonaConfig>,
  template: CookieTemplateConfig = DEFAULT_COOKIE_TEMPLATE,
): readonly CaptureCookie[] {
  const cookies: CaptureCookie[] = [];
  for (const role of MANDATORY_PERSONA_ROLES) {
    const persona = personas[role];
    const value =
      persona.mock_session_cookie !== undefined
        ? persona.mock_session_cookie
        : `mock_sess_${persona.role}_${persona.tenant_id}`;
    cookies.push({
      name: `${template.name}_${role}`,
      value,
      domain: template.domain,
      path: template.path,
      httpOnly: template.http_only,
      secure: template.secure,
      sameSite: template.same_site,
    });
  }
  return cookies;
}

export function validatePersonaGovernance(policy?: RepoPolicy): PersonaGovernanceSyncResult {
  const resolved = resolveEffectivePolicy(policy);
  const personas = getAllUserPersonas(resolved);
  const diffs: string[] = [];
  const records: PersonaGovernanceRecord[] = [];

  for (const role of MANDATORY_PERSONA_ROLES) {
    const persona = personas[role];
    if (persona === undefined) {
      diffs.push(`Missing mandatory persona role in policy: ${role}`);
      continue;
    }
    if (typeof persona.email !== "string") {
      diffs.push(`Persona '${role}' has invalid or missing email: ${persona.email}`);
    } else if (persona.email.indexOf("@") === -1) {
      diffs.push(`Persona '${role}' has invalid or missing email: ${persona.email}`);
    }

    if (typeof persona.password_env_var !== "string") {
      diffs.push(`Persona '${role}' is missing password_env_var credential binding`);
    } else if (persona.password_env_var.length === 0) {
      diffs.push(`Persona '${role}' is missing password_env_var credential binding`);
    }

    if (typeof persona.tenant_id !== "string") {
      diffs.push(`Persona '${role}' is missing tenant_id isolation`);
    } else if (persona.tenant_id.length === 0) {
      diffs.push(`Persona '${role}' is missing tenant_id isolation`);
    }

    if (persona.permissions === undefined) {
      diffs.push(`Persona '${role}' has empty permission scope`);
    } else if (persona.permissions.length === 0) {
      diffs.push(`Persona '${role}' has empty permission scope`);
    }

    records.push({
      role: persona.role,
      email: persona.email,
      passwordEnvVar: persona.password_env_var,
      displayName: persona.display_name,
      tenantId: persona.tenant_id,
      permissions: persona.permissions,
      mockSessionCookie: persona.mock_session_cookie,
    });
  }

  return {
    synchronized: diffs.length === 0,
    syncedPersonas: records,
    driftDetected: diffs.length > 0,
    diffs,
  };
}

export function syncPersonasWithDockerPolicy(
  policy?: RepoPolicy,
  captureConfig?: { readonly auth?: CaptureAuthConfig | undefined },
): PersonaGovernanceSyncResult {
  const policyResult = validatePersonaGovernance(policy);
  if (!policyResult.synchronized) {
    return policyResult;
  }

  const diffs: string[] = [...policyResult.diffs];
  const auth = captureConfig !== undefined ? captureConfig.auth : undefined;
  const users = auth !== undefined ? auth.users : undefined;
  if (users !== undefined) {
    for (const role of MANDATORY_PERSONA_ROLES) {
      const captureUser = users[role];
      if (captureUser === undefined) {
        diffs.push(`Capture config auth.users missing persona user: ${role}`);
      }
    }
  }

  return {
    synchronized: diffs.length === 0,
    syncedPersonas: policyResult.syncedPersonas,
    driftDetected: diffs.length > 0,
    diffs,
  };
}
