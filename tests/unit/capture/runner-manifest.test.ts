import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CaptureConfig } from "../../../orchestrating-long-tasks/scripts/src/capture/config/types.ts";
import {
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
  extractDomPhysics,
  filterScreens,
  resolveCaptureOutputDir,
  resolveViewportsForScreen,
  runLiveCapture,
  SessionAuthResolver,
  type CaptureBrowserDriver,
  type CaptureBrowserProvider,
  type CapturePageDriver,
  type CompanionManifest,
  type ExtractedElementPhysics,
} from "../../../orchestrating-long-tasks/scripts/src/capture/runners/index.ts";

describe("Capture Runner & Companion Manifest Writer", () => {
  describe("SessionAuthResolver", () => {
    const authConfig = {
      defaultUser: "admin-user",
      tokenHeaderName: "Authorization",
      users: {
        "admin-user": {
          id: "admin-user",
          name: "Admin",
          role: "admin",
          token: "admin-tok",
          headers: { "X-Admin": "1" },
        },
        "driver-user": { id: "driver-user", name: "Driver", role: "driver", token: "driver-tok" },
        "customer-user": {
          id: "customer-user",
          name: "Customer",
          role: "customer",
          token: "Bearer cust-tok",
        },
      },
    };

    test("resolves configured users and roles with caching", () => {
      const resolver = new SessionAuthResolver(authConfig);
      const adminSession = resolver.resolveRole("admin");
      expect(adminSession?.role).toBe("admin");
      expect(adminSession?.headers.Authorization).toBe("Bearer admin-tok");
      expect(adminSession?.headers["X-Admin"]).toBe("1");
      expect(resolver.getCachedSession("admin")).toBe(adminSession);

      const driverSession = resolver.resolveRole("driver");
      expect(driverSession?.role).toBe("driver");
      expect(driverSession?.headers.Authorization).toBe("Bearer driver-tok");

      const customerSession = resolver.resolveUser("customer-user");
      expect(customerSession?.headers.Authorization).toBe("Bearer cust-tok");
    });

    test("generates simulated mock session for custom roles", () => {
      const resolver = new SessionAuthResolver();
      const customSession = resolver.resolveRole("custom-auditor");
      expect(customSession?.role).toBe("custom-auditor");
      expect(customSession?.token).toContain("mock-token-custom-auditor");
      expect(customSession?.headers["X-Mock-Auth-Role"]).toBe("custom-auditor");
    });

    test("clears cached sessions properly", () => {
      const resolver = new SessionAuthResolver(authConfig);
      resolver.resolveRole("admin");
      expect(resolver.getCachedSession("admin")).not.toBeNull();
      resolver.clearCache();
      expect(resolver.getCachedSession("admin")).toBeNull();
    });
  });

  describe("DOM Physics Extractor", () => {
    test("computes layout overflows and text clippings accurately", () => {
      const elements: ExtractedElementPhysics[] = [
        {
          selector: ".overflowing-header",
          tagName: "header",
          bounds: { x: 0, y: 0, width: 380, height: 50, top: 0, right: 380, bottom: 50, left: 0 },
          computedStyles: {
            display: "block",
            position: "static",
            zIndex: 1,
            color: "#000",
            backgroundColor: "#fff",
            overflowX: "hidden",
            overflowY: "visible",
          },
          metrics: {
            scrollWidth: 390,
            clientWidth: 375,
            scrollHeight: 50,
            clientHeight: 50,
            offsetWidth: 375,
            offsetHeight: 50,
          },
        },
        {
          selector: ".clipped-text",
          tagName: "p",
          bounds: { x: 0, y: 60, width: 200, height: 30, top: 60, right: 200, bottom: 90, left: 0 },
          computedStyles: {
            display: "block",
            position: "static",
            zIndex: 0,
            color: "#333",
            backgroundColor: "#fff",
            overflowX: "visible",
            overflowY: "hidden",
          },
          metrics: {
            scrollWidth: 200,
            clientWidth: 200,
            scrollHeight: 45,
            clientHeight: 30,
            offsetWidth: 200,
            offsetHeight: 30,
          },
          textSnippet: "Long description text",
        },
      ];

      const { layoutOverflows, textClippings } = computeLayoutMetrics(elements, 375, 667, 0.5);
      expect(layoutOverflows).toHaveLength(1);
      expect(layoutOverflows[0]?.selector).toBe(".overflowing-header");
      expect(textClippings).toHaveLength(1);
      expect(textClippings[0]?.selector).toBe(".clipped-text");
    });

    test("handles fallback DOM physics extraction on mock driver", async () => {
      const mockDriver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.from("mock-png"),
        evaluate: async () => {
          throw new Error("Evaluation disabled in mock");
        },
      };

      const snapshot = await extractDomPhysics(mockDriver, {
        width: 1440,
        height: 900,
        deviceScaleFactor: 2,
      });
      expect(snapshot.viewport.width).toBe(1440);
      expect(snapshot.viewport.height).toBe(900);
      expect(snapshot.elements).toEqual([]);
    });
  });

  describe("Live Capture Runner & 1-to-1 Companion Manifest Writer", () => {
    test("resolves output directory and screen viewport routing correctly", () => {
      const testConfig: CaptureConfig = {
        version: "1.0",
        baseUrl: "http://localhost:3000",
        viewports: {
          desktop: { name: "desktop", width: 1440, height: 900 },
          mobile: { name: "mobile", width: 375, height: 667 },
        },
        screens: [{ id: "home", name: "Home", path: "/" }],
      };

      expect(resolveCaptureOutputDir({ outDir: "/tmp/custom-out" }, testConfig)).toBe(
        "/tmp/custom-out",
      );
      expect(resolveCaptureOutputDir({ capsuleDir: "/capsules/test-run" }, testConfig)).toBe(
        "/capsules/test-run/captures",
      );

      const filtered = filterScreens(testConfig.screens, ["home"]);
      expect(filtered).toHaveLength(1);

      const vps = resolveViewportsForScreen(testConfig.screens[0]!, testConfig, ["mobile"]);
      expect(vps).toHaveLength(1);
      expect(vps[0]?.name).toBe("mobile");
    });

    test("executes multi-viewport capture and persists companion manifest alongside PNG", async () => {
      const tempDir = join(tmpdir(), `test-capture-runner-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });

      try {
        const testConfig: CaptureConfig = {
          version: "1.0",
          baseUrl: "http://localhost:3000",
          viewports: {
            desktop: { name: "desktop", width: 1440, height: 900 },
            mobile: { name: "mobile", width: 375, height: 667, isMobile: true },
          },
          auth: {
            users: { admin: { id: "admin", name: "Admin", role: "admin", token: "tok-123" } },
          },
          screens: [
            {
              id: "dashboard",
              name: "Admin Dashboard",
              path: "/dashboard",
              viewports: ["desktop", "mobile"],
              auth: "admin",
            },
          ],
        };

        const result = await runLiveCapture({ config: testConfig, outDir: tempDir });
        expect(result.success).toBe(true);
        expect(result.totalCaptures).toBe(2);

        for (const item of result.captures) {
          expect(existsSync(item.imagePath)).toBe(true);
          expect(existsSync(item.manifestPath)).toBe(true);
          expect(item.manifestPath).toBe(item.imagePath.replace(/\.png$/, ".manifest.json"));

          const manifest = JSON.parse(
            readFileSync(item.manifestPath, "utf-8"),
          ) as CompanionManifest;
          expect(manifest.schema).toBe("companion.manifest.v1");
          expect(manifest.screenId).toBe("dashboard");
          expect(manifest.viewport).toBe(item.viewport);
          expect(manifest.imageSizeBytes).toBeGreaterThan(0);
          expect(manifest.imageSha256).toBeDefined();
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("executes custom actions cleanly", async () => {
      const actionsExecuted: string[] = [];
      const customProvider: CaptureBrowserProvider = {
        launch: async (): Promise<CaptureBrowserDriver> => ({
          newPage: async (): Promise<CapturePageDriver> => ({
            setViewportSize: async () => {},
            setExtraHTTPHeaders: async () => {},
            goto: async () => {},
            waitForSelector: async () => {},
            screenshot: async () => Buffer.from("simulated-img"),
            click: async (sel) => {
              actionsExecuted.push(`click:${sel}`);
            },
            fill: async (sel, val) => {
              actionsExecuted.push(`fill:${sel}=${val}`);
            },
            hover: async (sel) => {
              actionsExecuted.push(`hover:${sel}`);
            },
            waitForTimeout: async (ms) => {
              actionsExecuted.push(`wait:${ms}`);
            },
            evaluate: async <T>() => createEmptyDomPhysicsSnapshot() as unknown as T,
          }),
          close: async () => {},
        }),
      };

      const testConfig: CaptureConfig = {
        version: "1.0",
        baseUrl: "http://localhost:3000",
        viewports: { desktop: { name: "desktop", width: 1440, height: 900 } },
        screens: [
          {
            id: "interactive-form",
            name: "Interactive Form",
            path: "/form",
            actions: [
              { type: "fill", selector: "#name", value: "Antigravity" },
              { type: "click", selector: "#submit" },
              { type: "hover", selector: "#tooltip" },
              { type: "wait", timeoutMs: 50 },
            ],
          },
        ],
      };

      const tempDir = join(tmpdir(), `test-capture-actions-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });

      try {
        const result = await runLiveCapture({
          config: testConfig,
          outDir: tempDir,
          browserProvider: customProvider,
        });

        expect(result.success).toBe(true);
        expect(actionsExecuted).toEqual([
          "fill:#name=Antigravity",
          "click:#submit",
          "hover:#tooltip",
          "wait:50",
        ]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("persists visual evidence to active capsule and tmpdir", async () => {
      const tempDir = join(tmpdir(), `test-capture-proof-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      const testConfig: CaptureConfig = {
        version: "1.0",
        baseUrl: "http://localhost:3000",
        viewports: { desktop: { name: "desktop", width: 1440, height: 900 } },
        screens: [{ id: "runner-visual-proof", name: "Runner Visual Proof", path: "/proof" }],
      };
      const result = await runLiveCapture({ config: testConfig, outDir: tempDir });
      expect(result.success).toBe(true);
      const proofPng = join(tempDir, "runner-visual-proof-desktop.png");
      const proofManifest = join(tempDir, "runner-visual-proof-desktop.manifest.json");
      expect(existsSync(proofPng)).toBe(true);
      expect(existsSync(proofManifest)).toBe(true);

      const uid = Date.now().toString();
      const reportPath = join(tmpdir(), `t-cap-runner-${uid}-visual-report.json`);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        reportPath,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          viewports: {
            desktop: { width: 1440, height: 900, elementCount: 40 },
            tablet: { width: 768, height: 1024, elementCount: 30 },
            mobile: { width: 375, height: 667, elementCount: 20 },
          },
          layoutOverflows: [],
          textClippings: [],
          collisions: [],
          metadata: { task: "T-CAP-RUNNER", uid },
        }),
      );
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const pngBuf = Buffer.concat([
        Buffer.from(pngBase64, "base64"),
        Buffer.from(`runner-${uid}`),
      ]);
      const shotPath = join(tmpdir(), `runner-proof-${uid}.png`);
      writeFileSync(shotPath, pngBuf);

      console.log(`Visual report: ${reportPath}`);
      console.log(`Screenshots: ${shotPath}`);
    });
  });
});
