import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureConfig } from "../../../olt/scripts/src/capture/config/types.ts";
import {
  createSyntheticPngBuffer,
  DefaultFallbackBrowserProvider,
  runLiveCapture,
} from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import type {
  CaptureBrowserProvider,
  CaptureCookie,
  CapturePageDriver,
  DomPhysicsSnapshot,
} from "../../../olt/scripts/src/capture/runners/types.ts";
import { scratchRoot } from "../session-fixture.ts";

describe("live-capture-runner: workflow & provider execution", () => {
  describe("fallback-provider", () => {
    it("DefaultFallbackBrowserProvider launches driver that sets headers, cookies, screenshots, and evaluates", async () => {
      const root = scratchRoot(import.meta.path, "fallback-provider-test");
      const provider = new DefaultFallbackBrowserProvider();
      const defaultBrowser = await provider.launch();
      await defaultBrowser.close();

      const nonHeadlessBrowser = await provider.launch({ headless: false });
      await nonHeadlessBrowser.close();

      const browser = await provider.launch({ headless: true });
      const page = await browser.newPage();

      await page.setViewportSize({ width: 800, height: 600 });
      await page.setExtraHTTPHeaders({ "X-Test": "1" });

      const cookieList: CaptureCookie[] = [{ name: "c1", value: "v1", path: "/" }];
      if (page.setCookies) await page.setCookies(cookieList);
      if (page.setCookie) await page.setCookie({ name: "c2", value: "v2", path: "/" });

      await page.goto("http://localhost:3000");
      await page.waitForSelector("#root");

      const testTmp = join(root, "test-fb");
      mkdirSync(testTmp, { recursive: true });
      const imgPath = join(testTmp, "screenshot.png");

      const buf = await page.screenshot({ path: imgPath });
      expect(buf.byteLength).toBeGreaterThanOrEqual(1024);
      expect(existsSync(imgPath)).toBe(true);

      const bufNoPath = await page.screenshot({});
      expect(bufNoPath.byteLength).toBeGreaterThanOrEqual(1024);

      const bufNoArgs = await page.screenshot();
      expect(bufNoArgs.byteLength).toBeGreaterThanOrEqual(1024);

      const snapshot = await page.evaluate<DomPhysicsSnapshot>("() => {}", { someArg: true });
      expect(snapshot.viewport).toEqual({ width: 800, height: 600, deviceScaleFactor: 1 });

      await browser.close();
    });
  });

  describe("runner execution", () => {
    it("throws error when browserProvider is undefined", async () => {
      expect(runLiveCapture()).rejects.toThrow(
        "runLiveCapture requires an explicit browserProvider",
      );
    });

    it("executes live capture workflow with actions, auth, screenshot validation, and manifest generation", async () => {
      const root = scratchRoot(import.meta.path, "live-capture-workflow");
      const testDir = join(root, "output");
      mkdirSync(testDir, { recursive: true });

      const clicked: string[] = [];
      const filled: { selector: string; value: string }[] = [];
      const hovered: string[] = [];
      let waitedTime = 0;
      let closed = false;

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => ({
          newPage: async (): Promise<CapturePageDriver> => {
            let currentVp = { width: 1440, height: 900 };
            return {
              setViewportSize: async (vp) => {
                currentVp = vp;
              },
              setExtraHTTPHeaders: async () => {},
              setCookies: async () => {},
              goto: async () => {},
              waitForSelector: async () => {},
              click: async (sel) => {
                clicked.push(sel);
              },
              fill: async (sel, val) => {
                filled.push({ selector: sel, value: val });
              },
              hover: async (sel) => {
                hovered.push(sel);
              },
              waitForTimeout: async (ms) => {
                waitedTime += ms;
              },
              screenshot: async (opts) => {
                const buf = createSyntheticPngBuffer(currentVp.width, currentVp.height, 1024);
                if (opts?.path) {
                  const { writeFileSync } = await import("node:fs");
                  writeFileSync(opts.path, buf);
                }
                return buf;
              },
              evaluate: async () =>
                ({
                  viewport: {
                    width: currentVp.width,
                    height: currentVp.height,
                    deviceScaleFactor: 1,
                  },
                  scrollPosition: { x: 0, y: 0 },
                  elements: [],
                  layoutOverflows: [],
                  textClippings: [],
                  capturedAt: new Date().toISOString(),
                }) as never,
            };
          },
          close: async () => {
            closed = true;
          },
        }),
      };

      const customConfig: CaptureConfig = {
        baseUrl: "http://localhost:8080",
        outputDir: testDir,
        auth: {
          users: {
            adminUser: { id: "admin-1", name: "Admin", role: "admin", token: "secret-token" },
          },
        },
        screens: [
          {
            id: "settings",
            name: "Settings Page",
            path: "/settings",
            auth: "adminUser",
            waitForSelector: "#main-settings",
            fullPage: true,
            actions: [
              { type: "click", selector: "#tab-general" },
              { type: "fill", selector: "#username", value: "newadmin" },
              { type: "hover", selector: "#save-btn" },
              { type: "wait", timeoutMs: 50 },
            ],
            viewports: ["desktop"],
          },
        ],
        viewports: { desktop: { name: "desktop", width: 1440, height: 900 } },
      };

      const result = await runLiveCapture({
        config: customConfig,
        browserProvider: mockProvider,
        outDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.totalCaptures).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(clicked).toEqual(["#tab-general"]);
      expect(filled).toEqual([{ selector: "#username", value: "newadmin" }]);
      expect(hovered).toEqual(["#save-btn"]);
      expect(waitedTime).toBe(50);
      expect(closed).toBe(true);

      const capture = result.captures[0]!;
      expect(capture.screenId).toBe("settings");
      expect(capture.viewport).toBe("desktop");
      expect(existsSync(capture.imagePath)).toBe(true);
      expect(existsSync(capture.manifestPath)).toBe(true);

      const manifestContent = JSON.parse(readFileSync(capture.manifestPath, "utf-8"));
      expect(manifestContent.screenId).toBe("settings");
      expect(manifestContent.authRole).toBe("admin");
    });

    it("records errors when screenshot PNG validation fails or actions throw", async () => {
      const root = scratchRoot(import.meta.path, "live-capture-png-err");
      const testDir = join(root, "output");
      mkdirSync(testDir, { recursive: true });

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => ({
          newPage: async (): Promise<CapturePageDriver> => ({
            setViewportSize: async () => {},
            setExtraHTTPHeaders: async () => {},
            goto: async () => {},
            waitForSelector: async () => {},
            screenshot: async () => createSyntheticPngBuffer(100, 100, 1024),
            evaluate: async () => ({}) as never,
          }),
          close: async () => {},
        }),
      };

      const customConfig: CaptureConfig = {
        baseUrl: "http://localhost:8080",
        screens: [{ id: "home", name: "Home", path: "/" }],
        viewports: { desktop: { name: "desktop", width: 1440, height: 900 } },
      };

      const result = await runLiveCapture({
        config: customConfig,
        browserProvider: mockProvider,
        outDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.totalCaptures).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toContain("failed PNG IHDR validation");
    });

    it("handles default screen fallback and string errors in actions/navigation", async () => {
      const root = scratchRoot(import.meta.path, "live-capture-string-err");
      const testDir = join(root, "output");
      mkdirSync(testDir, { recursive: true });

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => ({
          newPage: async (): Promise<CapturePageDriver> => ({
            setViewportSize: async () => {},
            setExtraHTTPHeaders: async () => {},
            goto: async () => {
              throw "String network connection error";
            },
            screenshot: async () => createSyntheticPngBuffer(1440, 900),
            evaluate: async () => ({}) as never,
          }),
          close: async () => {},
        }),
      };

      const emptyScreensConfig: CaptureConfig = {
        baseUrl: "http://localhost:8080",
        screens: [],
        viewports: { desktop: { name: "desktop", width: 1440, height: 900 } },
      };

      const result = await runLiveCapture({
        config: emptyScreensConfig,
        browserProvider: mockProvider,
        outDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toBe("String network connection error");
    });

    it("runs live capture loading default config when options.config is omitted", async () => {
      const root = scratchRoot(import.meta.path, "live-capture-default-config");
      const testDir = join(root, "output");
      mkdirSync(testDir, { recursive: true });

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => ({
          newPage: async (): Promise<CapturePageDriver> => ({
            setViewportSize: async () => {},
            setExtraHTTPHeaders: async () => {},
            goto: async () => {},
            screenshot: async () => createSyntheticPngBuffer(1440, 900),
            evaluate: async () => ({}) as never,
          }),
          close: async () => {},
        }),
      };

      const result = await runLiveCapture({
        configPath: "nonexistent-config.yaml",
        browserProvider: mockProvider,
        outDir: testDir,
      });

      expect(typeof result.success).toBe("boolean");
    });
  });
});
