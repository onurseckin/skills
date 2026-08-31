import { describe, expect, it } from "bun:test";
import { validateCaptureConfig } from "../../olt/scripts/src/capture/config/config-loader.ts";
import { CANONICAL_VIEWPORTS } from "../../olt/scripts/src/capture/config/default-presets.ts";
import {
  generateInitialConfigJson,
  generateInitialConfigYaml,
} from "../../olt/scripts/src/cli/commands/capture-init.ts";
import { resolveViewportsForScreen } from "../../olt/scripts/src/capture/runners/index.ts";
import type { CaptureConfig } from "../../olt/scripts/src/capture/config/types.ts";

describe("Capture Configuration Schema", () => {
  it("CANONICAL_VIEWPORTS has no isMobile or hasTouch properties", () => {
    for (const [name, vp] of Object.entries(CANONICAL_VIEWPORTS)) {
      expect((vp as unknown as Record<string, unknown>).isMobile).toBeUndefined();
      expect((vp as unknown as Record<string, unknown>).hasTouch).toBeUndefined();
      expect(vp.name).toBe(name);
      expect(vp.width).toBeGreaterThan(0);
      expect(vp.height).toBeGreaterThan(0);
      expect(vp.deviceScaleFactor).toBeGreaterThanOrEqual(1);
    }
  });

  it("validateCaptureConfig strips or ignores hasTouch and isMobile", () => {
    const raw = {
      version: "1.0",
      baseUrl: "http://localhost:3000",
      viewports: {
        customMobile: {
          width: 375,
          height: 667,
          isMobile: true,
          hasTouch: true,
        },
      },
      auth: {
        users: {
          alice: {
            id: "alice",
            name: "Alice Admin",
            role: "admin",
            email: "alice@example.test",
            username: "alice",
            password: "SecretPassword123!",
            token: "jwt-token-123",
          },
        },
      },
    };

    const parsed = validateCaptureConfig(raw);
    const customVp = parsed.viewports.customMobile!;
    expect(customVp).toBeDefined();
    expect((customVp as unknown as Record<string, unknown>).isMobile).toBeUndefined();
    expect((customVp as unknown as Record<string, unknown>).hasTouch).toBeUndefined();
    expect(customVp.width).toBe(375);
    expect(customVp.height).toBe(667);

    // Verify user config contains all required credentials fields
    const user = parsed.auth?.users.alice;
    expect(user).toBeDefined();
    expect(user?.email).toBe("alice@example.test");
    expect(user?.username).toBe("alice");
    expect(user?.password).toBe("SecretPassword123!");
    expect(user?.role).toBe("admin");
    expect(user?.name).toBe("Alice Admin");
    expect(user?.token).toBe("jwt-token-123");
  });

  it("capture-init YAML template does not contain isMobile or hasTouch, and has clean credentials", () => {
    const yaml = generateInitialConfigYaml();
    expect(yaml).not.toContain("isMobile");
    expect(yaml).not.toContain("is_mobile");
    expect(yaml).not.toContain("hasTouch");
    expect(yaml).not.toContain("has_touch");
    expect(yaml).toContain('email: "admin@example.test"');
    expect(yaml).toContain('username: "admin"');
    expect(yaml).toContain('password: "Password123!"');
    expect(yaml).toContain('loginUrl: "/login"');
    expect(yaml).toContain("usernameSelector:");
    expect(yaml).toContain("passwordSelector:");
    expect(yaml).toContain("submitSelector:");
  });

  it("capture-init JSON template does not contain isMobile or hasTouch, and has clean credentials", () => {
    const json = generateInitialConfigJson();
    const parsed = JSON.parse(json);
    for (const vp of Object.values(parsed.viewports as Record<string, Record<string, unknown>>)) {
      expect(vp.isMobile).toBeUndefined();
      expect(vp.hasTouch).toBeUndefined();
    }
    expect(parsed.auth.loginUrl).toBe("/login");
    expect(parsed.auth.usernameSelector).toBeDefined();
    expect(parsed.auth.passwordSelector).toBeDefined();
    expect(parsed.auth.submitSelector).toBeDefined();
    expect(parsed.auth.users.admin.email).toBe("admin@example.test");
    expect(parsed.auth.users.admin.username).toBe("admin");
    expect(parsed.auth.users.admin.password).toBe("Password123!");
    expect(parsed.auth.users.admin.role).toBe("admin");
  });

  it("resolveViewportsForScreen defaults to all viewports when screen viewports and target viewports are omitted", () => {
    const config: CaptureConfig = {
      version: "1.0",
      baseUrl: "http://localhost:3000",
      viewports: CANONICAL_VIEWPORTS,
      screens: [],
    };

    const screenWithoutViewports = {
      id: "home",
      name: "Homepage",
      path: "/",
    };

    const resolved = resolveViewportsForScreen(screenWithoutViewports, config);
    expect(resolved.length).toBe(Object.keys(CANONICAL_VIEWPORTS).length);
    const names = resolved.map((v) => v.name);
    expect(names).toContain("desktop");
    expect(names).toContain("desktop-wide");
    expect(names).toContain("tablet");
    expect(names).toContain("mobile");
  });

  it("resolveViewportsForScreen respects explicitly targeted viewports", () => {
    const config: CaptureConfig = {
      version: "1.0",
      baseUrl: "http://localhost:3000",
      viewports: CANONICAL_VIEWPORTS,
      screens: [],
    };

    const screenWithoutViewports = {
      id: "home",
      name: "Homepage",
      path: "/",
    };

    const resolved = resolveViewportsForScreen(screenWithoutViewports, config, ["mobile"]);
    expect(resolved.length).toBe(1);
    expect(resolved[0]?.name).toBe("mobile");
    expect(resolved[0]?.width).toBe(390);
  });
});
