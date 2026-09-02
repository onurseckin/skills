import { describe, expect, it, spyOn } from "bun:test";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_COOKIE_TEMPLATE,
  MANDATORY_PERSONA_ROLES,
  extractCaptureAuthFromPolicy,
  generateMockSessionCookies,
  getAllUserPersonas,
  getUserPersona,
  isUserPersonaRole,
  mapPolicyPersonaToCaptureUser,
  syncPersonasWithDockerPolicy,
  validatePersonaGovernance,
} from "../../olt/scripts/src/platform/capture/persona-governance.ts";
import type {
  CookieTemplateConfig,
  RepoPolicy,
  UserPersonaConfig,
  UserPersonaRole,
} from "../../olt/scripts/src/platform/capture/types.ts";
import * as policyModule from "../../olt/scripts/src/policy/index.ts";

function createValidPersonas(): Record<UserPersonaRole, UserPersonaConfig> {
  return {
    admin: {
      role: "admin",
      email: "admin@corp.internal",
      password_env_var: "ADMIN_KEY",
      display_name: "Admin User",
      tenant_id: "corp-t1",
      permissions: ["*"],
    },
    standard_user: {
      role: "standard_user",
      email: "standard@corp.internal",
      password_env_var: "STD_KEY",
      display_name: "Standard Member",
      tenant_id: "corp-t1",
      permissions: ["read", "write"],
    },
    invited_member: {
      role: "invited_member",
      email: "invited@corp.internal",
      password_env_var: "INV_KEY",
      display_name: "Invited Guest",
      tenant_id: "corp-t1",
      permissions: ["read"],
    },
    guest: {
      role: "guest",
      email: "guest@corp.internal",
      password_env_var: "GST_KEY",
      display_name: "Guest Visitor",
      tenant_id: "corp-t1",
      permissions: ["public_read"],
    },
  };
}

describe("Platform Capture - Persona Governance Module", () => {
  it("identifies user persona roles correctly and rejects invalid roles", () => {
    for (const role of MANDATORY_PERSONA_ROLES) {
      expect(isUserPersonaRole(role)).toBe(true);
    }
    expect(isUserPersonaRole("superadmin")).toBe(false);
    expect(isUserPersonaRole("")).toBe(false);
    expect(isUserPersonaRole(null)).toBe(false);
    expect(isUserPersonaRole(undefined)).toBe(false);
    expect(isUserPersonaRole(123)).toBe(false);
    expect(isUserPersonaRole({})).toBe(false);
  });

  it("exports default cookie template constants", () => {
    expect(DEFAULT_COOKIE_TEMPLATE.name).toBe("olt_session_id");
    expect(DEFAULT_COOKIE_TEMPLATE.domain).toBe("localhost");
    expect(DEFAULT_COOKIE_TEMPLATE.path).toBe("/");
    expect(DEFAULT_COOKIE_TEMPLATE.http_only).toBe(true);
    expect(DEFAULT_COOKIE_TEMPLATE.secure).toBe(false);
    expect(DEFAULT_COOKIE_TEMPLATE.same_site).toBe("Lax");
  });

  it("retrieves all personas from policy or canonical fallbacks", () => {
    const policyWithPersonas = {
      docker_environment: { test_user_personas: createValidPersonas() },
    } as unknown as RepoPolicy;
    const personas = getAllUserPersonas(policyWithPersonas);
    expect(personas.admin.email).toBe("admin@corp.internal");
    expect(personas.standard_user.email).toBe("standard@corp.internal");

    const partialPolicy = {
      docker_environment: {
        test_user_personas: {
          admin: {
            role: "admin",
            email: "custom_admin@corp.internal",
            password_env_var: "ADM_VAR",
            display_name: "Custom Admin",
            tenant_id: "t-1",
            permissions: ["*"],
          },
        } as unknown as Record<UserPersonaRole, UserPersonaConfig>,
      },
    } as unknown as RepoPolicy;
    const partialPersonas = getAllUserPersonas(partialPolicy);
    expect(partialPersonas.admin.email).toBe("custom_admin@corp.internal");
    expect(partialPersonas.standard_user.role).toBe("standard_user");

    const emptyPolicy = {} as RepoPolicy;
    const defaultPersonas = getAllUserPersonas(emptyPolicy);
    expect(defaultPersonas.admin.role).toBe("admin");

    const fromDiskPersonas = getAllUserPersonas();
    expect(fromDiskPersonas.admin).toBeDefined();
  });

  it("falls back to hardcoded default personas when canonical generator has no docker_environment", () => {
    const spy = spyOn(policyModule, "generateCanonicalDefaultPolicy").mockReturnValue(
      {} as unknown as RepoPolicy,
    );
    try {
      const fallbackPersonas = getAllUserPersonas({} as unknown as RepoPolicy);
      expect(fallbackPersonas.admin.email).toBe("admin@olt.local");
      expect(fallbackPersonas.standard_user.email).toBe("user@olt.local");
      expect(fallbackPersonas.invited_member.email).toBe("invited@olt.local");
      expect(fallbackPersonas.guest.email).toBe("guest@olt.local");
    } finally {
      spy.mockRestore();
    }
  });

  it("retrieves individual persona and handles errors", () => {
    const policy = {
      docker_environment: { test_user_personas: createValidPersonas() },
    } as unknown as RepoPolicy;
    const admin = getUserPersona("admin", policy);
    expect(admin.role).toBe("admin");
    expect(admin.email).toBe("admin@corp.internal");

    expect(() => getUserPersona("unknown" as UserPersonaRole, policy)).toThrow(HarnessError);
    expect(() => getUserPersona("unknown" as UserPersonaRole, policy)).toThrow(
      "User persona role 'unknown' not found",
    );

    const spy = spyOn(policyModule, "generateCanonicalDefaultPolicy").mockReturnValue({
      docker_environment: {
        test_user_personas: {} as unknown as Record<UserPersonaRole, UserPersonaConfig>,
      },
    } as unknown as RepoPolicy);
    try {
      expect(() => getUserPersona("admin", {} as unknown as RepoPolicy)).toThrow(
        "User persona 'admin' not configured in policy",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("maps policy persona to capture user config with default and custom cookie templates", () => {
    const persona: UserPersonaConfig = {
      role: "admin",
      email: "lead_dev@domain.com",
      password_env_var: "ADMIN_PW",
      display_name: "Lead Developer",
      tenant_id: "t-dev",
      permissions: ["*"],
    };

    const captureUser = mapPolicyPersonaToCaptureUser(persona);
    expect(captureUser.id).toBe("admin");
    expect(captureUser.name).toBe("Lead Developer");
    expect(captureUser.username).toBe("lead_dev");
    expect(captureUser.password).toBe("mock_pw_admin");
    expect(captureUser.token).toBe("tok_persona_admin_t-dev");
    expect(captureUser.cookies.length).toBe(1);
    expect(captureUser.cookies[0]?.name).toBe("olt_session_id");
    expect(captureUser.cookies[0]?.value).toBe("mock_sess_admin_t-dev");

    const personaWithMockCookie: UserPersonaConfig = {
      ...persona,
      mock_session_cookie: "custom_cookie_12345",
      email: "@domain.com",
    };
    const customTemplate: CookieTemplateConfig = {
      name: "custom_session",
      domain: "app.local",
      path: "/api",
      http_only: false,
      secure: true,
      same_site: "Strict",
    };
    const captureUserCustom = mapPolicyPersonaToCaptureUser(personaWithMockCookie, customTemplate);
    expect(captureUserCustom.username).toBe("admin");
    expect(captureUserCustom.cookies[0]?.name).toBe("custom_session");
    expect(captureUserCustom.cookies[0]?.value).toBe("custom_cookie_12345");
  });

  it("extracts capture auth config from repo policy with default or custom cookie templates", () => {
    const pDef = {
      docker_environment: {
        test_user_personas: createValidPersonas(),
        session_cookie_templates: {
          default: {
            name: "def_tok",
            domain: "a.local",
            path: "/",
            http_only: true,
            secure: false,
            same_site: "Lax" as const,
          },
        },
        auth_paths: { login_url: "/signin" },
      },
    } as unknown as RepoPolicy;
    const a1 = extractCaptureAuthFromPolicy(pDef);
    expect(a1.loginUrl === "/signin" && a1.users["admin"]?.cookies[0]?.name === "def_tok").toBe(
      true,
    );

    const pSess = {
      docker_environment: {
        test_user_personas: createValidPersonas(),
        session_cookie_templates: {
          session: {
            name: "sess_tok",
            domain: "s.local",
            path: "/",
            http_only: true,
            secure: true,
            same_site: "Strict" as const,
          },
        },
      },
    } as unknown as RepoPolicy;
    expect(extractCaptureAuthFromPolicy(pSess).users["admin"]?.cookies[0]?.name).toBe("sess_tok");
    expect(extractCaptureAuthFromPolicy({} as RepoPolicy).users["admin"]?.cookies[0]?.name).toBe(
      "olt_session_id",
    );
  });

  it("generates mock session cookies for all mandatory roles", () => {
    const personas = createValidPersonas();
    personas.admin = { ...personas.admin, mock_session_cookie: "custom_admin_cookie" };
    const cookies = generateMockSessionCookies(personas);
    expect(cookies.length).toBe(4);
    expect(cookies.find((c) => c.name === "olt_session_id_admin")?.value).toBe(
      "custom_admin_cookie",
    );
  });

  it("validates persona governance and syncs with docker policy and capture config", () => {
    const validPolicy = {
      docker_environment: { test_user_personas: createValidPersonas() },
    } as unknown as RepoPolicy;
    expect(validatePersonaGovernance(validPolicy).synchronized).toBe(true);
    expect(syncPersonasWithDockerPolicy(validPolicy).synchronized).toBe(true);

    const invalidPolicy = {
      docker_environment: {
        test_user_personas: {
          admin: {
            role: "admin",
            email: "invalid",
            password_env_var: "",
            tenant_id: "",
            permissions: [],
          },
        },
      },
    } as unknown as RepoPolicy;
    expect(validatePersonaGovernance(invalidPolicy).driftDetected).toBe(true);
    expect(syncPersonasWithDockerPolicy(invalidPolicy).synchronized).toBe(false);

    const missingCapture = syncPersonasWithDockerPolicy(validPolicy, {
      auth: {
        defaultUser: "admin",
        loginUrl: "/l",
        usernameSelector: "u",
        passwordSelector: "p",
        submitSelector: "s",
        tokenHeaderName: "A",
        users: { admin: mapPolicyPersonaToCaptureUser(createValidPersonas().admin) },
      },
    });
    expect(missingCapture.driftDetected).toBe(true);
  });
});
