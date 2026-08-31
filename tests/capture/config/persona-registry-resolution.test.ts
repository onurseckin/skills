import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COOKIE_TEMPLATE,
  formatCookieString,
  generateMockSessionCookie,
  getAllUserPersonas,
  resolveSessionCookieTemplate,
} from "../../../olt/scripts/src/capture/persona-registry.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
  CookieTemplateConfig,
  RepoPolicy,
  UserPersonaRole,
} from "../../../olt/scripts/src/policy/types/index.ts";

const customPolicy: RepoPolicy = {
  schema_version: 1,
  ecosystem: "bun",
  test_runner: {
    default_command: "bun test",
    targeted_pattern: "bun test <path>",
    full_suite_command: "bun test",
    timeout_ms: 30000,
  },
  docker_environment: {
    enabled: true,
    compose_file: "docker-compose.test.yml",
    containers: {},
    test_user_personas: {
      admin: {
        role: "admin",
        email: "sec-admin@tenant-alpha.io",
        password_env_var: "ALPHA_ADMIN_SECRET",
        display_name: "Alpha Admin",
        tenant_id: "tenant-alpha-01",
        permissions: ["*", "billing:manage", "tenant:admin"],
        mock_session_cookie: "custom_cookie_admin_alpha_token_998877",
      },
      standard_user: {
        role: "standard_user",
        email: "member@tenant-beta.io",
        password_env_var: "BETA_USER_SECRET",
        display_name: "Beta Member",
        tenant_id: "tenant-beta-02",
        permissions: ["documents:read", "documents:write"],
        mock_session_cookie: "custom_cookie_member_beta_token_112233",
      },
      invited_member: {
        role: "invited_member",
        email: "guest-invite@tenant-gamma.io",
        password_env_var: "GAMMA_INVITE_SECRET",
        display_name: "Gamma Invited",
        tenant_id: "tenant-gamma-03",
        permissions: ["documents:read"],
        mock_session_cookie: "custom_cookie_invited_gamma_token_445566",
      },
      guest: {
        role: "guest",
        email: "anonymous@tenant-public.io",
        password_env_var: "PUBLIC_GUEST_SECRET",
        display_name: "Public Visitor",
        tenant_id: "tenant-public-00",
        permissions: ["public:view"],
      },
    },
    auth_paths: {
      login_url: "http://localhost:3000/login",
      logout_url: "http://localhost:3000/logout",
      session_verify_url: "http://localhost:3000/api/auth/me",
    },
    session_cookie_templates: {
      session_id: {
        name: "custom_auth_sid",
        domain: "app.internal",
        path: "/api/v1",
        http_only: true,
        secure: true,
        same_site: "Strict",
      },
    },
  },
};

describe("persona-registry: cookie generation and template resolution", () => {
  test("formats cookie strings according to CookieTemplateConfig", () => {
    const template: CookieTemplateConfig = {
      name: "test_sid",
      domain: "example.com",
      path: "/app",
      http_only: true,
      secure: true,
      same_site: "Strict",
    };

    const cookie = formatCookieString(template, "token_xyz_123");
    expect(cookie).toBe(
      "test_sid=token_xyz_123; Path=/app; Domain=example.com; SameSite=Strict; HttpOnly; Secure",
    );
  });

  test("generates mock session cookie using default policy and template", () => {
    const adminCookie = generateMockSessionCookie("admin");
    expect(adminCookie).toContain("olt_session_id=");
    expect(adminCookie).toContain("Path=/");
    expect(adminCookie).toContain("Domain=localhost");
    expect(adminCookie).toContain("SameSite=Lax");
    expect(adminCookie).toContain("HttpOnly");
    expect(adminCookie).toContain("olt_session_admin_mock_token_sec991823");
  });

  test("generates mock session cookie using custom policy and template", () => {
    const adminCookie = generateMockSessionCookie("admin", customPolicy);
    expect(adminCookie).toBe(
      "custom_auth_sid=custom_cookie_admin_alpha_token_998877; Path=/api/v1; Domain=app.internal; SameSite=Strict; HttpOnly; Secure",
    );

    const userCookie = generateMockSessionCookie("standard_user", customPolicy);
    expect(userCookie).toBe(
      "custom_auth_sid=custom_cookie_member_beta_token_112233; Path=/api/v1; Domain=app.internal; SameSite=Strict; HttpOnly; Secure",
    );
  });

  test("generates fallback mock token when persona does not define mock_session_cookie", () => {
    const guestCookie = generateMockSessionCookie("guest", customPolicy);
    expect(guestCookie).toContain("custom_auth_sid=olt_session_guest_mock_token");
    expect(guestCookie).toContain("Path=/api/v1");
    expect(guestCookie).toContain("Domain=app.internal");
    expect(guestCookie).toContain("SameSite=Strict");
  });

  test("generateMockSessionCookie throws HarnessError with NOT_FOUND on unknown role", () => {
    expect(() => generateMockSessionCookie("unknown" as UserPersonaRole)).toThrow(HarnessError);
    try {
      generateMockSessionCookie("unknown" as UserPersonaRole);
    } catch (err) {
      expect(err).toBeInstanceOf(HarnessError);
      expect((err as HarnessError).code).toBe("NOT_FOUND");
    }
  });

  test("resolveSessionCookieTemplate falls back to DEFAULT_COOKIE_TEMPLATE when templates missing or empty", () => {
    const emptyPolicy: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
    };
    expect(resolveSessionCookieTemplate(emptyPolicy)).toEqual(DEFAULT_COOKIE_TEMPLATE);

    const policyWithEmptyTemplates: RepoPolicy = {
      ...emptyPolicy,
      docker_environment: {
        enabled: true,
        session_cookie_templates: {},
      },
    };
    expect(resolveSessionCookieTemplate(policyWithEmptyTemplates)).toEqual(DEFAULT_COOKIE_TEMPLATE);
  });

  test("resolveSessionCookieTemplate prioritizes default and first template when session_id is absent", () => {
    const policyWithDefault: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: { default_command: "bun test", targeted_pattern: "", full_suite_command: "" },
      docker_environment: {
        enabled: true,
        session_cookie_templates: {
          default: { name: "default_sid", http_only: false },
        },
      },
    };
    expect(resolveSessionCookieTemplate(policyWithDefault)).toEqual({
      name: "default_sid",
      http_only: false,
    });

    const policyWithOtherKey: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: { default_command: "bun test", targeted_pattern: "", full_suite_command: "" },
      docker_environment: {
        enabled: true,
        session_cookie_templates: {
          custom_auth_token: { name: "auth_token_key" },
        },
      },
    };
    expect(resolveSessionCookieTemplate(policyWithOtherKey)).toEqual({ name: "auth_token_key" });
  });

  test("formatCookieString handles minimal template with no optional attributes", () => {
    const minimalTemplate: CookieTemplateConfig = {
      name: "bare_token",
      http_only: false,
      secure: false,
    };
    expect(formatCookieString(minimalTemplate, "val-123")).toBe("bare_token=val-123");
  });

  test("getAllUserPersonas fills in missing roles from fallback defaults when policy has partial personas", () => {
    const partialPolicy: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: { default_command: "bun test", targeted_pattern: "", full_suite_command: "" },
      docker_environment: {
        enabled: true,
        test_user_personas: {
          admin: {
            role: "admin",
            email: "custom-admin@test.io",
            password_env_var: "CUSTOM_PASS",
            display_name: "Custom Admin",
            tenant_id: "t-1",
            permissions: ["*"],
            mock_session_cookie: "  custom_cookie_trimmed  ",
          },
        },
      },
    };

    const personas = getAllUserPersonas(partialPolicy);
    expect(personas.admin.email).toBe("custom-admin@test.io");
    expect(personas.standard_user).toBeDefined();
    expect(personas.standard_user.email).toBe("user@olt.local");
    expect(personas.invited_member).toBeDefined();
    expect(personas.guest).toBeDefined();

    const adminCookie = generateMockSessionCookie("admin", partialPolicy);
    expect(adminCookie).toContain("custom_cookie_trimmed");

    const emptyCookiePolicy: RepoPolicy = {
      ...partialPolicy,
      docker_environment: {
        enabled: true,
        test_user_personas: {
          admin: {
            role: "admin",
            email: "admin@test.io",
            password_env_var: "PASS",
            display_name: "Admin",
            tenant_id: "t-1",
            permissions: ["*"],
            mock_session_cookie: "   ",
          },
        },
      },
    };
    const cookieWithFallback = generateMockSessionCookie("admin", emptyCookiePolicy);
    expect(cookieWithFallback).toContain("olt_session_admin_mock_token");
  });
});
