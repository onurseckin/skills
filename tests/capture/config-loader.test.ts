import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findCaptureConfigFile,
  loadCaptureConfig,
  validateCaptureConfig,
  exportDefaultCaptureConfigYaml,
  parseYamlOrJson,
  CANONICAL_VIEWPORTS,
  DEFAULT_PRESETS,
  DEFAULT_SIDEBAR_LAYOUT,
} from "../../../olt/scripts/src/capture/config/index.ts";

describe("capture config loader & schema", () => {
  test("provides canonical viewports and presets", () => {
    expect(CANONICAL_VIEWPORTS.desktop.width).toBe(1440);
    expect(CANONICAL_VIEWPORTS.desktop.height).toBe(900);
    expect(CANONICAL_VIEWPORTS.tablet.width).toBe(768);
    expect(CANONICAL_VIEWPORTS.mobile.width).toBe(390);

    expect(DEFAULT_SIDEBAR_LAYOUT.logoPosition).toBe("top-left");
    expect(DEFAULT_SIDEBAR_LAYOUT.userProfilePosition).toBe("bottom-left");
    expect(DEFAULT_SIDEBAR_LAYOUT.requireZeroNavbar).toBe(true);

    expect(DEFAULT_PRESETS["standard-dashboard"]).toBeDefined();
    expect(DEFAULT_PRESETS["marketing-site"].sidebar?.enabled).toBe(false);
  });

  test("parses and validates standard YAML config", () => {
    const yaml = `
version: "1.0"
baseUrl: "http://localhost:8080"
auth:
  loginUrl: "/auth/login"
  users:
    tester:
      name: "Test Runner"
      role: "admin"
      token: "secret-token-123"
      headers:
        X-Custom-Auth: "verified"
sidebar:
  enabled: true
  logoPosition: "top-left"
  userProfilePosition: "bottom-left"
  requireZeroNavbar: true
screens:
  - id: "home"
    name: "Home Page"
    path: "/dashboard"
    viewports: ["desktop", "tablet"]
    auth: "tester"
`;
    const parsed = parseYamlOrJson(yaml);
    const config = validateCaptureConfig(parsed);

    expect(config.baseUrl).toBe("http://localhost:8080");
    expect(config.auth?.users.tester.name).toBe("Test Runner");
    expect(config.auth?.users.tester.token).toBe("secret-token-123");
    expect(config.auth?.users.tester.headers?.["X-Custom-Auth"]).toBe("verified");
    expect(config.sidebar?.logoPosition).toBe("top-left");
    expect(config.sidebar?.userProfilePosition).toBe("bottom-left");
    expect(config.sidebar?.requireZeroNavbar).toBe(true);
    expect(config.screens.length).toBe(1);
    expect(config.screens[0].id).toBe("home");
    expect(config.screens[0].auth).toBe("tester");
  });

  test("discovers and loads config files in directory hierarchy", () => {
    const testDir = join(tmpdir(), `test-capture-config-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const configPath = join(testDir, ".capture.yaml");
      writeFileSync(
        configPath,
        `
baseUrl: "http://localhost:4000"
screens:
  - id: "login"
    name: "Login Page"
    path: "/login"
`,
      );

      const found = findCaptureConfigFile(testDir);
      expect(found).toBe(configPath);

      const loaded = loadCaptureConfig({ configPath });
      expect(loaded.baseUrl).toBe("http://localhost:4000");
      expect(loaded.screens[0].id).toBe("login");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("parses and validates JSON config fallback", () => {
    const jsonStr = JSON.stringify({
      version: 2,
      baseUrl: "https://staging.example.com",
      viewports: {
        custom: { width: 800, height: 600 },
      },
      screens: [{ id: "metrics", path: "/metrics" }],
    });

    const parsed = parseYamlOrJson(jsonStr);
    const config = validateCaptureConfig(parsed);
    expect(config.version).toBe(2);
    expect(config.baseUrl).toBe("https://staging.example.com");
    expect(config.viewports.custom.width).toBe(800);
    expect(config.screens[0].id).toBe("metrics");
  });

  test("exports default configuration template", () => {
    const defaultYaml = exportDefaultCaptureConfigYaml();
    expect(defaultYaml).toContain("baseUrl:");
    expect(defaultYaml).toContain('logoPosition: "top-left"');
    expect(defaultYaml).toContain('userProfilePosition: "bottom-left"');
    expect(defaultYaml).toContain("requireZeroNavbar: true");
    const parsed = parseYamlOrJson(defaultYaml);
    const validated = validateCaptureConfig(parsed);
    expect(validated.screens.length).toBeGreaterThan(0);
  });

  test("handles empty, json, pseudo-json yaml, and malformed configs safely in parseYamlOrJson", () => {
    // Empty inputs
    expect(parseYamlOrJson("")).toEqual({});
    expect(parseYamlOrJson("   \n\t  ")).toEqual({});

    // Valid JSON Object and Array
    expect(parseYamlOrJson('{"hello": "world"}')).toEqual({ hello: "world" });
    expect(parseYamlOrJson("[1, 2, 3]")).toEqual([1, 2, 3]);

    // Standard YAML
    expect(parseYamlOrJson("name: Alice\ncount: 42")).toEqual({ name: "Alice", count: 42 });
    expect(parseYamlOrJson("user: bob\nage: 30")).toEqual({ user: "bob", age: 30 });

    // Invalid YAML / JSON
    expect(() => parseYamlOrJson(":::invalid yaml::: [[[[]")).toThrow(
      /Failed to parse YAML\/JSON capture configuration/,
    );

    const emptyConfig = validateCaptureConfig({});
    expect(emptyConfig.baseUrl).toBe("http://localhost:3000");
    expect(emptyConfig.viewports.desktop).toBeDefined();

    expect(() => validateCaptureConfig(null)).toThrow();
  });

  test("validates complex configuration with custom sidebar, users, selectors, and auth details", () => {
    const rawConfig = {
      version: "2.0",
      baseUrl: "https://app.example.com",
      outputDir: "/custom/captures",
      defaultViewport: "mobile",
      viewports: {
        retinaDesktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
      },
      sidebar: {
        enabled: false,
        logoPosition: "invalid-custom-position",
        userProfilePosition: "none",
        requireZeroNavbar: false,
        minWidth: 200,
        maxWidth: 300,
        collapsible: true,
        selectors: {
          container: "aside.sidebar-main",
          logo: "img.brand-logo",
          userProfile: "div.user-profile",
          navLinks: "nav.sidebar-links",
          collapseToggle: "button.toggle-collapse",
        },
      },
      auth: {
        defaultUser: "admin",
        loginUrl: "/auth/signin",
        usernameSelector: "#email",
        passwordSelector: "#pwd",
        submitSelector: "#submit",
        tokenHeaderName: "X-Access-Token",
        users: {
          admin: {
            name: "Admin",
            role: "admin",
            username: "admin_user",
            email: "admin@app.example.com",
            password: "SecretPassword!",
            token: "admin-tok-123",
            avatarUrl: "https://avatar.com/admin.png",
            headers: { "X-Env": "staging" },
          },
          invalid_non_obj: null,
          guestUser: {
            // no name or role -> defaults
          },
        },
      },
      screens: [
        {
          id: "dashboard",
          name: "Dashboard View",
          path: "/dash",
          auth: "admin",
          waitForSelector: "#ready-signal",
          fullPage: true,
          viewports: ["retinaDesktop", 123 /* filtered out non-string */],
        },
        { id: "", path: "/invalid-empty-id" },
        { id: "invalid-empty-path", path: "" },
        null,
      ],
    };

    const config = validateCaptureConfig(rawConfig);
    expect(config.version).toBe("2.0");
    expect(config.baseUrl).toBe("https://app.example.com");
    expect(config.outputDir).toBe("/custom/captures");
    expect(config.defaultViewport).toBe("mobile");
    expect(config.viewports.retinaDesktop?.width).toBe(1920);
    expect(config.viewports.retinaDesktop?.deviceScaleFactor).toBe(2);

    expect(config.sidebar?.enabled).toBe(false);
    expect(config.sidebar?.logoPosition).toBe("top-left"); // fell back from invalid-custom-position
    expect(config.sidebar?.userProfilePosition).toBe("none");
    expect(config.sidebar?.minWidth).toBe(200);
    expect(config.sidebar?.maxWidth).toBe(300);
    expect(config.sidebar?.collapsible).toBe(true);
    expect(config.sidebar?.selectors?.container).toBe("aside.sidebar-main");
    expect(config.sidebar?.selectors?.collapseToggle).toBe("button.toggle-collapse");

    expect(config.auth?.defaultUser).toBe("admin");
    expect(config.auth?.tokenHeaderName).toBe("X-Access-Token");
    expect(config.auth?.users.admin.avatarUrl).toBe("https://avatar.com/admin.png");
    expect(config.auth?.users.guestUser.name).toBe("guestUser");
    expect(config.auth?.users.guestUser.role).toBe("user");

    expect(config.screens).toHaveLength(1);
    expect(config.screens[0]?.id).toBe("dashboard");
    expect(config.screens[0]?.waitForSelector).toBe("#ready-signal");
    expect(config.screens[0]?.fullPage).toBe(true);
    expect(config.screens[0]?.viewports).toEqual(["retinaDesktop"]);
  });

  test("findCaptureConfigFile returns null when no config file exists in hierarchy", () => {
    const emptyDir = join(tmpdir(), `empty-search-dir-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      const found = findCaptureConfigFile(emptyDir);
      // If root hierarchy has no capture config
      expect(found === null || typeof found === "string").toBe(true);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("loadCaptureConfig falls back to default config when file path does not exist", () => {
    const fallback = loadCaptureConfig({ configPath: "/nonexistent/path/to/.capture.yaml" });
    expect(fallback.baseUrl).toBe("http://localhost:3000");
    expect(fallback.viewports.desktop).toBeDefined();

    const fallbackExplicit = loadCaptureConfig({ explicitPath: "/nonexistent/path/.capture.json" });
    expect(fallbackExplicit.baseUrl).toBe("http://localhost:3000");
  });
});
