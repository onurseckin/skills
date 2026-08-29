import type {
  AuthPathsConfig,
  ContainerConfig,
  CookieTemplateConfig,
  DockerTestProfile,
  UserPersonaConfig,
  UserPersonaRole,
} from "../types/index.ts";
import {
  assertAllowedKeys,
  integrity,
  isRecord,
  reqBool,
  reqInt,
  reqString,
} from "./primitives.ts";

const DOCKER_ENV_KEYS: ReadonlySet<string> = new Set([
  "enabled",
  "compose_file",
  "containers",
  "test_user_personas",
  "auth_paths",
  "session_cookie_templates",
]);

const CONTAINER_KEYS: ReadonlySet<string> = new Set([
  "container_name",
  "image",
  "ports",
  "health_endpoint",
  "ready_timeout_ms",
  "env",
]);

const PERSONA_KEYS: ReadonlySet<string> = new Set([
  "role",
  "email",
  "password_env_var",
  "display_name",
  "tenant_id",
  "permissions",
  "mock_session_cookie",
]);

const AUTH_PATHS_KEYS: ReadonlySet<string> = new Set([
  "login_url",
  "logout_url",
  "signup_url",
  "session_verify_url",
]);

const COOKIE_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "name",
  "domain",
  "path",
  "http_only",
  "secure",
  "same_site",
]);

const ALLOWED_PERSONA_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "standard_user",
  "invited_member",
  "guest",
]);

const ALLOWED_SAME_SITE: ReadonlySet<string> = new Set(["Strict", "Lax", "None"]);

export function parseContainerConfig(raw: unknown, p: string): ContainerConfig {
  if (!isRecord(raw)) integrity(p, "must be object");
  assertAllowedKeys(raw, CONTAINER_KEYS, p);

  const ports = Array.isArray(raw["ports"])
    ? (raw["ports"] as unknown[]).map((port, i) => reqString(port, `${p}.ports[${i}]`))
    : integrity(`${p}.ports`, "must be array");

  let env: Record<string, string> | undefined;
  if (isRecord(raw["env"])) {
    env = Object.fromEntries(
      Object.entries(raw["env"]).map(([ek, ev]) => [ek, reqString(ev, `${p}.env.${ek}`)]),
    );
  }

  return {
    container_name: reqString(raw["container_name"], `${p}.container_name`),
    image: reqString(raw["image"], `${p}.image`),
    ports,
    health_endpoint: reqString(raw["health_endpoint"], `${p}.health_endpoint`),
    ready_timeout_ms: reqInt(raw["ready_timeout_ms"], `${p}.ready_timeout_ms`, 1),
    ...(env !== undefined ? { env } : {}),
  };
}

export function parseUserPersona(raw: unknown, p: string): UserPersonaConfig {
  if (!isRecord(raw)) integrity(p, "must be object");
  assertAllowedKeys(raw, PERSONA_KEYS, p);

  const r = reqString(raw["role"], `${p}.role`);
  if (!ALLOWED_PERSONA_ROLES.has(r)) integrity(`${p}.role`, "invalid persona role");

  const permissions = Array.isArray(raw["permissions"])
    ? (raw["permissions"] as unknown[]).map((perm, i) => reqString(perm, `${p}.permissions[${i}]`))
    : [];

  return {
    role: r as UserPersonaRole,
    email: reqString(raw["email"], `${p}.email`),
    password_env_var: reqString(raw["password_env_var"], `${p}.password_env_var`),
    display_name: reqString(raw["display_name"], `${p}.display_name`),
    tenant_id: reqString(raw["tenant_id"], `${p}.tenant_id`),
    permissions,
    ...(raw["mock_session_cookie"] !== undefined
      ? { mock_session_cookie: reqString(raw["mock_session_cookie"], `${p}.mock_session_cookie`) }
      : {}),
  };
}

export function parseAuthPaths(raw: unknown, p: string): AuthPathsConfig {
  if (!isRecord(raw)) integrity(p, "must be object");
  assertAllowedKeys(raw, AUTH_PATHS_KEYS, p);

  return {
    login_url: reqString(raw["login_url"], `${p}.login_url`),
    logout_url: reqString(raw["logout_url"], `${p}.logout_url`),
    ...(raw["signup_url"] !== undefined
      ? { signup_url: reqString(raw["signup_url"], `${p}.signup_url`) }
      : {}),
    session_verify_url: reqString(raw["session_verify_url"], `${p}.session_verify_url`),
  };
}

export function parseCookieTemplate(raw: unknown, p: string): CookieTemplateConfig {
  if (!isRecord(raw)) integrity(p, "must be object");
  assertAllowedKeys(raw, COOKIE_TEMPLATE_KEYS, p);

  const sameSite = reqString(raw["same_site"], `${p}.same_site`);
  if (!ALLOWED_SAME_SITE.has(sameSite)) integrity(`${p}.same_site`, "invalid same_site");

  return {
    name: reqString(raw["name"], `${p}.name`),
    domain: reqString(raw["domain"], `${p}.domain`),
    path: reqString(raw["path"], `${p}.path`),
    http_only: reqBool(raw["http_only"], `${p}.http_only`),
    secure: reqBool(raw["secure"], `${p}.secure`),
    same_site: sameSite as "Strict" | "Lax" | "None",
  };
}

export function parseDockerEnv(raw: unknown, p: string): DockerTestProfile {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, DOCKER_ENV_KEYS, p);

  const containers: Record<string, ContainerConfig> = {};
  if (isRecord(raw["containers"])) {
    for (const [k, v] of Object.entries(raw["containers"])) {
      containers[k] = parseContainerConfig(v, `${p}.containers.${k}`);
    }
  }

  const personas: Record<UserPersonaRole, UserPersonaConfig> = {} as Record<
    UserPersonaRole,
    UserPersonaConfig
  >;
  if (isRecord(raw["test_user_personas"])) {
    for (const [role, v] of Object.entries(raw["test_user_personas"])) {
      personas[role as UserPersonaRole] = parseUserPersona(v, `${p}.test_user_personas.${role}`);
    }
  }

  const authPaths = parseAuthPaths(raw["auth_paths"], `${p}.auth_paths`);

  const cookies: Record<string, CookieTemplateConfig> = {};
  if (isRecord(raw["session_cookie_templates"])) {
    for (const [k, v] of Object.entries(raw["session_cookie_templates"])) {
      cookies[k] = parseCookieTemplate(v, `${p}.session_cookie_templates.${k}`);
    }
  }

  return {
    enabled: reqBool(raw["enabled"], `${p}.enabled`),
    ...(raw["compose_file"] !== undefined
      ? { compose_file: reqString(raw["compose_file"], `${p}.compose_file`) }
      : {}),
    containers,
    test_user_personas: personas,
    auth_paths: authPaths,
    session_cookie_templates: cookies,
  };
}
