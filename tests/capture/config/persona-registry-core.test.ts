import { describe, expect, test } from "bun:test";
import {
  CANONICAL_PERSONA_ROLES,
  getAllUserPersonas,
  getUserPersona,
  isUserPersonaRole,
} from "../../../olt/scripts/src/capture/persona-registry.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
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
  },
};

describe("persona-registry: core roles and persona extraction", () => {
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

    test("handles fallback when role exists in canonical list but missing in partial policy", () => {
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
});
