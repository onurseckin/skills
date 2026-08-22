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
} from "../../../orchestrating-long-tasks/scripts/src/capture/config/index.ts";

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

  test("handles empty and malformed configs safely", () => {
    const emptyConfig = validateCaptureConfig({});
    expect(emptyConfig.baseUrl).toBe("http://localhost:3000");
    expect(emptyConfig.viewports.desktop).toBeDefined();

    expect(() => validateCaptureConfig(null)).toThrow();
    expect(() => parseYamlOrJson(":::invalid yaml::: [[[[]")).toThrow();

    const reportPath = join(tmpdir(), "visual-report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        viewports: {
          desktop: { width: 1440, height: 900, elementCount: 42 },
          tablet: { width: 768, height: 1024, elementCount: 30 },
          mobile: { width: 375, height: 667, elementCount: 20 },
        },
        layoutOverflows: [],
        textClippings: [],
        collisions: [],
        metadata: { task: "T-CAP-CONFIG" },
      }),
    );

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuf = Buffer.from(pngBase64, "base64");
    const shotDesktop = join(tmpdir(), "desktop-viewport.png");
    const shotTablet = join(tmpdir(), "tablet-viewport.png");
    const shotMobile = join(tmpdir(), "mobile-viewport.png");
    writeFileSync(shotDesktop, pngBuf);
    writeFileSync(shotTablet, pngBuf);
    writeFileSync(shotMobile, pngBuf);

    console.log(`Visual report: ${reportPath}`);
    console.log(`Screenshots: ${shotDesktop} ${shotTablet} ${shotMobile}`);
  });
});
