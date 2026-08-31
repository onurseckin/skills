import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/index.ts";
import { generateCanonicalDefaultPolicy, loadRepoPolicy } from "../policy/index.ts";
import type {
  CookieTemplateConfig,
  RepoPolicy,
  UserPersonaConfig,
  UserPersonaRole,
} from "../policy/types/index.ts";

export const CANONICAL_PERSONA_ROLES: readonly UserPersonaRole[] = [
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
  return typeof role === "string" && CANONICAL_PERSONA_ROLES.includes(role as UserPersonaRole);
}

function resolveRepoRoot(): string {
  return findRepoRoot();
}

function getFallbackDefaultPersonas(): Record<UserPersonaRole, UserPersonaConfig> {
  const defaultPolicy = generateCanonicalDefaultPolicy(resolveRepoRoot());
  return defaultPolicy.docker_environment?.test_user_personas ?? {
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
  return policy ?? loadRepoPolicy();
}

export function getAllUserPersonas(
  policy?: RepoPolicy,
): Record<UserPersonaRole, UserPersonaConfig> {
  const resolved = resolveEffectivePolicy(policy);
  const personas = resolved.docker_environment?.test_user_personas;
  if (personas) {
    const defaults = getFallbackDefaultPersonas();
    return {
      admin: personas.admin ?? defaults.admin,
      standard_user: personas.standard_user ?? defaults.standard_user,
      invited_member: personas.invited_member ?? defaults.invited_member,
      guest: personas.guest ?? defaults.guest,
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
  if (!persona) {
    throw new HarnessError("NOT_FOUND", `User persona role '${role}' not found in registry`);
  }
  return persona;
}

export function formatCookieString(template: CookieTemplateConfig, tokenValue: string): string {
  const segments: string[] = [`${template.name}=${tokenValue}`];
  if (template.path) {
    segments.push(`Path=${template.path}`);
  }
  if (template.domain) {
    segments.push(`Domain=${template.domain}`);
  }
  if (template.same_site) {
    segments.push(`SameSite=${template.same_site}`);
  }
  if (template.http_only) {
    segments.push("HttpOnly");
  }
  if (template.secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}

export function resolveSessionCookieTemplate(policy?: RepoPolicy): CookieTemplateConfig {
  const resolved = resolveEffectivePolicy(policy);
  const templates = resolved.docker_environment?.session_cookie_templates;
  if (templates) {
    if (templates["session_id"]) {
      return templates["session_id"];
    }
    if (templates["default"]) {
      return templates["default"];
    }
    const first = Object.values(templates)[0];
    if (first) {
      return first;
    }
  }
  return DEFAULT_COOKIE_TEMPLATE;
}

export function generateMockSessionCookie(role: UserPersonaRole, policy?: RepoPolicy): string {
  const persona = getUserPersona(role, policy);
  const template = resolveSessionCookieTemplate(policy);
  const token =
    persona.mock_session_cookie && persona.mock_session_cookie.trim().length > 0
      ? persona.mock_session_cookie.trim()
      : `olt_session_${role}_mock_token`;

  return formatCookieString(template, token);
}
