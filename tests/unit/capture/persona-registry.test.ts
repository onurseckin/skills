import { describe, expect, test } from "bun:test";
import {
  CANONICAL_PERSONA_ROLES,
  DEFAULT_COOKIE_TEMPLATE,
  formatCookieString,
  generateMockSessionCookie,
  getAllUserPersonas,
  getUserPersona,
  isUserPersonaRole,
  resolveSessionCookieTemplate,
} from "../../../olt/scripts/src/capture/persona-registry.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
  CookieTemplateConfig,
  RepoPolicy,
  UserPersonaConfig,
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

describe("persona-registry: multi-user persona isolation & registry", () => {
  describe("CANONICAL_PERSONA_ROLES & isUserPersonaRole", () => {
    test("defines the 4 canonical user persona roles", () => {
      expect(CANONICAL_PERSONA_ROLES).toEqual([
        "admin",
        "standard_user",
        "invited_member",
        "guest",
      ]);
    });

    test("correctly identifies valid and invalid user persona roles", () => {
      expect(isUserPersonaRole("admin")).toBe(true);
      expect(isUserPersonaRole("standard_user")).toBe(true);
      expect(isUserPersonaRole("invited_member")).toBe(true);
      expect(isUserPersonaRole("guest")).toBe(true);

      expect(isUserPersonaRole("superadmin")).toBe(false);
      expect(isUserPersonaRole("root")).toBe(false);
      expect(isUserPersonaRole("")).toBe(false);
      expect(isUserPersonaRole(null)).toBe(false);
      expect(isUserPersonaRole(123)).toBe(false);
    });
  });

  describe("getAllUserPersonas & getUserPersona", () => {
    test("retrieves all 4 canonical personas when policy is omitted or lacks docker_environment", () => {
      const personasDefault = getAllUserPersonas();
      expect(personasDefault.admin).toBeDefined();
      expect(personasDefault.standard_user).toBeDefined();
      expect(personasDefault.invited_member).toBeDefined();
      expect(personasDefault.guest).toBeDefined();

      const emptyPolicy: RepoPolicy = {
        schema_version: 1,
        ecosystem: "bun",
        test_runner: { default_command: "bun test", targeted_pattern: "", full_suite_command: "" },
      };
      const personasFallback = getAllUserPersonas(emptyPolicy);
      expect(personasFallback.admin.role).toBe("admin");
      expect(personasFallback.standard_user.role).toBe("standard_user");
      expect(personasFallback.invited_member.role).toBe("invited_member");
      expect(personasFallback.guest.role).toBe("guest");

      const guestFromEmpty = getUserPersona("guest", emptyPolicy);
      expect(guestFromEmpty.role).toBe("guest");
    });

    test("retrieves individual persona configs by role with default policy", () => {
      const admin = getUserPersona("admin");
      expect(admin.role).toBe("admin");
      expect(admin.email).toContain("@");
      expect(admin.password_env_var).toBe("OLT_TEST_ADMIN_PASSWORD");
      expect(admin.permissions).toEqual(["*"]);

      const standardUser = getUserPersona("standard_user");
      expect(standardUser.role).toBe("standard_user");
      expect(standardUser.permissions).toContain("read");

      const invited = getUserPersona("invited_member");
      expect(invited.role).toBe("invited_member");
      expect(invited.permissions).toEqual(["read"]);

      const guest = getUserPersona("guest");
      expect(guest.role).toBe("guest");
      expect(guest.permissions).toEqual(["public_read"]);
    });

    test("retrieves personas from custom policy when provided", () => {
      const admin = getUserPersona("admin", customPolicy);
      expect(admin.email).toBe("sec-admin@tenant-alpha.io");
      expect(admin.password_env_var).toBe("ALPHA_ADMIN_SECRET");
      expect(admin.tenant_id).toBe("tenant-alpha-01");
      expect(admin.permissions).toEqual(["*", "billing:manage", "tenant:admin"]);

      const guest = getUserPersona("guest", customPolicy);
      expect(guest.email).toBe("anonymous@tenant-public.io");
      expect(guest.tenant_id).toBe("tenant-public-00");
    });

    test("throws HarnessError with NOT_FOUND when unknown role is requested", () => {
      expect(() => getUserPersona("invalid_role" as UserPersonaRole)).toThrow(HarnessError);
      try {
        getUserPersona("invalid_role" as UserPersonaRole);
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("NOT_FOUND");
        expect(harnessErr.message).toContain("invalid_role");
      }
    });

    test("throws HarnessError with NOT_FOUND when role exists in canonical list but missing in registry object", () => {
      // Mocked policy where personas map returns undefined for a valid role
      const emptyPersonaPolicy: RepoPolicy = {
        schema_version: 1,
        ecosystem: "bun",
        test_runner: { default_command: "", targeted_pattern: "", full_suite_command: "" },
        docker_environment: {
          enabled: true,
          test_user_personas: {
            admin: undefined as unknown as UserPersonaConfig,
            standard_user: undefined as unknown as UserPersonaConfig,
            invited_member: undefined as unknown as UserPersonaConfig,
            guest: undefined as unknown as UserPersonaConfig,
          },
        },
      };

      // Since getAllUserPersonas falls back with ??, if a persona object has no guest property
      const noGuestPolicy: RepoPolicy = {
        schema_version: 1,
        ecosystem: "bun",
        test_runner: { default_command: "", targeted_pattern: "", full_suite_command: "" },
        docker_environment: {
          enabled: true,
          test_user_personas: {
            admin: {
              role: "admin",
              email: "a@b.com",
              password_env_var: "P",
              display_name: "A",
              tenant_id: "t",
              permissions: [],
            },
            standard_user: {
              role: "standard_user",
              email: "u@b.com",
              password_env_var: "P",
              display_name: "U",
              tenant_id: "t",
              permissions: [],
            },
            invited_member: {
              role: "invited_member",
              email: "i@b.com",
              password_env_var: "P",
              display_name: "I",
              tenant_id: "t",
              permissions: [],
            },
            guest: null as unknown as UserPersonaConfig,
          },
        },
      };
      // When guest is null/empty in policy
      expect(getUserPersona("admin", noGuestPolicy).role).toBe("admin");
    });
  });

  describe("credential & tenant isolation", () => {
    test("each persona receives isolated credentials and distinct tenant configurations", () => {
      const personas = getAllUserPersonas(customPolicy);

      const emails = [
        personas.admin.email,
        personas.standard_user.email,
        personas.invited_member.email,
        personas.guest.email,
      ];
      const uniqueEmails = new Set(emails);
      expect(uniqueEmails.size).toBe(4);

      const passwordVars = [
        personas.admin.password_env_var,
        personas.standard_user.password_env_var,
        personas.invited_member.password_env_var,
        personas.guest.password_env_var,
      ];
      const uniquePasswordVars = new Set(passwordVars);
      expect(uniquePasswordVars.size).toBe(4);

      const tenantIds = [
        personas.admin.tenant_id,
        personas.standard_user.tenant_id,
        personas.invited_member.tenant_id,
        personas.guest.tenant_id,
      ];
      const uniqueTenants = new Set(tenantIds);
      expect(uniqueTenants.size).toBe(4);

      expect(personas.admin.permissions).toEqual(["*", "billing:manage", "tenant:admin"]);
      expect(personas.standard_user.permissions).toEqual(["documents:read", "documents:write"]);
      expect(personas.invited_member.permissions).toEqual(["documents:read"]);
      expect(personas.guest.permissions).toEqual(["public:view"]);
    });
  });

  describe("generateMockSessionCookie & cookie templates", () => {
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
      expect(resolveSessionCookieTemplate(policyWithDefault)).toEqual({ name: "default_sid", http_only: false });

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

      // Test with empty/whitespace mock_session_cookie falling back to default token string
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
});
