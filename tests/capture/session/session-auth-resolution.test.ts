import { describe, expect, it } from "bun:test";
import {
  CANONICAL_ROLES,
  createSessionAuthResolver,
  SessionAuthResolver,
} from "../../../olt/scripts/src/capture/runners/session-auth-resolver.ts";
import type {
  CaptureAuthConfig,
  CaptureConfig,
} from "../../../olt/scripts/src/capture/config/types.ts";
import type { ResolvedSessionAuth } from "../../../olt/scripts/src/capture/runners/types.ts";

describe("session-auth-resolver: initialization, caching, and role resolution", () => {
  describe("constructor and initialization", () => {
    it("handles undefined config", () => {
      const resolver = new SessionAuthResolver();
      expect(resolver.getAuthConfig()).toBeUndefined();
    });

    it("handles CaptureAuthConfig object with users directly", () => {
      const authConfig: CaptureAuthConfig = {
        users: {
          admin: { id: "admin", name: "Admin", role: "admin" },
        },
      };
      const resolver = new SessionAuthResolver(authConfig);
      expect(resolver.getAuthConfig()).toBe(authConfig);
    });

    it("handles CaptureConfig wrapper with auth property", () => {
      const fullConfig = {
        auth: {
          tokenHeaderName: "X-Auth-Token",
          users: {
            driver: { id: "driver-1", name: "Driver", role: "driver" },
          },
        },
      } as unknown as CaptureConfig;
      const resolver = new SessionAuthResolver(fullConfig);
      expect(resolver.getAuthConfig()).toEqual(fullConfig.auth);
    });

    it("handles empty object or object without auth/users", () => {
      const resolver = new SessionAuthResolver({} as unknown as CaptureAuthConfig);
      expect(resolver.getAuthConfig()).toBeUndefined();
    });

    it("creates resolver via factory function createSessionAuthResolver", () => {
      const resolver = createSessionAuthResolver();
      expect(resolver).toBeInstanceOf(SessionAuthResolver);
    });
  });

  describe("getAllRoles", () => {
    it("returns canonical roles when no users configured", () => {
      const resolver = new SessionAuthResolver();
      const roles = resolver.getAllRoles();
      for (const canonical of CANONICAL_ROLES) {
        expect(roles).toContain(canonical);
      }
    });

    it("includes custom roles and user IDs from authConfig", () => {
      const resolver = new SessionAuthResolver({
        users: {
          u1: { id: "user-123", name: "Super User", role: "superadmin" },
          u2: { id: "guest-456", name: "Guest User", role: "guest" },
        },
      });
      const roles = resolver.getAllRoles();
      expect(roles).toContain("superadmin");
      expect(roles).toContain("user-123");
      expect(roles).toContain("guest");
      expect(roles).toContain("guest-456");
      expect(roles).toContain("admin");
    });
  });

  describe("cache management", () => {
    it("caches and retrieves sessions across key, role, and userId", () => {
      const resolver = new SessionAuthResolver();
      const session: ResolvedSessionAuth = {
        userId: "UID-001",
        role: "SpecialRole",
        name: "Test User",
        headers: { Authorization: "Bearer token" },
        resolvedAt: new Date().toISOString(),
      };

      resolver.cacheSession("my-key", session);
      expect(resolver.getCachedSession("my-key")).toBe(session);
      expect(resolver.getCachedSession("MY-KEY")).toBe(session);
      expect(resolver.getCachedSession("specialrole")).toBe(session);
      expect(resolver.getCachedSession("uid-001")).toBe(session);
      expect(resolver.getCachedSession("unknown")).toBeNull();

      resolver.clearCache();
      expect(resolver.getCachedSession("my-key")).toBeNull();
    });
  });

  describe("resolveRole", () => {
    it("returns cached session if already resolved", () => {
      const resolver = new SessionAuthResolver();
      const session: ResolvedSessionAuth = {
        userId: "cached",
        role: "admin",
        name: "Cached Admin",
        headers: {},
        resolvedAt: new Date().toISOString(),
      };
      resolver.cacheSession("admin", session);
      expect(resolver.resolveRole("ADMIN")).toBe(session);
    });

    it("returns simulated session when authConfig is undefined", () => {
      const resolver = new SessionAuthResolver();
      const session = resolver.resolveRole("custom-role");
      expect(session).not.toBeNull();
      expect(session?.role).toBe("custom-role");
      expect(session?.userId).toBe("custom-role");
      expect(session?.name).toBe("Simulated custom-role");
      expect(session?.headers.Authorization).toContain("Bearer mock-token-custom-role-");
      expect(session?.headers["X-Mock-Auth-Role"]).toBe("custom-role");
      expect(session?.cookies).toHaveLength(1);
    });

    it("matches user by key, id or role case-insensitively", () => {
      const resolver = new SessionAuthResolver({
        users: {
          adminUser: {
            id: "ID_ADMIN",
            name: "Main Admin",
            role: "Manager",
            token: "admin-secret-token",
            cookies: [{ name: "session", value: "s123", path: "/" }],
          },
        },
      });

      const byKey = resolver.resolveRole("adminuser");
      expect(byKey?.userId).toBe("ID_ADMIN");
      expect(byKey?.headers.Authorization).toBe("Bearer admin-secret-token");
      expect(byKey?.cookies).toBeDefined();

      resolver.clearCache();
      const byId = resolver.resolveRole("id_admin");
      expect(byId?.userId).toBe("ID_ADMIN");

      resolver.clearCache();
      const byRole = resolver.resolveRole("manager");
      expect(byRole?.userId).toBe("ID_ADMIN");
    });

    it("falls back to defaultUser when specified in authConfig", () => {
      const resolver = new SessionAuthResolver({
        defaultUser: "fallbackUser",
        users: {
          fallbackUser: {
            id: "fb-1",
            name: "Fallback Default",
            role: "default-role",
            token: "Bearer already-bearer-token",
          },
        },
      });

      const resolved = resolver.resolveRole("non-existent-role");
      expect(resolved?.userId).toBe("fb-1");
      expect(resolved?.headers.Authorization).toBe("Bearer already-bearer-token");
    });

    it("falls back to simulated session when defaultUser is not found in users dictionary", () => {
      const resolver = new SessionAuthResolver({
        defaultUser: "missingUser",
        users: {
          someUser: { id: "u1", name: "User 1", role: "role1" },
        },
      });

      const resolved = resolver.resolveRole("unknown-role");
      expect(resolved?.role).toBe("unknown-role");
      expect(resolved?.name).toBe("Simulated unknown-role");
    });
  });
});
