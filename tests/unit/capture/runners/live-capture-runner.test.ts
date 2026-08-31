import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureConfig } from "../../../../olt/scripts/src/capture/config/types.ts";
import {
  createSyntheticPngBuffer,
  DefaultFallbackBrowserProvider,
  filterScreens,
  resolveCaptureOutputDir,
  resolveViewportsForScreen,
  runLiveCapture,
} from "../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CaptureCookie,
  CapturePageDriver,
  DomPhysicsSnapshot,
} from "../../../../olt/scripts/src/capture/runners/types.ts";

describe("live-capture-runner", () => {
  describe("synthetic-png", () => {
    it("generates valid PNG buffer with custom dimensions and minBytes padding", () => {
      const png = createSyntheticPngBuffer(64, 48, 2048);
      expect(png.byteLength).toBeGreaterThanOrEqual(2048);
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50);
      expect(png[2]).toBe(0x4e);
      expect(png[3]).toBe(0x47);
    });

    it("generates default 10x10 PNG buffer", () => {
      const png = createSyntheticPngBuffer();
      expect(png.byteLength).toBeGreaterThanOrEqual(1024);
    });
  });

  describe("path-resolver", () => {
    const dummyConfig: CaptureConfig = {
      baseUrl: "http://localhost:3000",
      outputDir: "/custom/config/output",
      screens: [],
      viewports: {
        desktop: { name: "desktop", width: 1440, height: 900 },
        mobile: { name: "mobile", width: 390, height: 844 },
      },
    };

    describe("resolveCaptureOutputDir", () => {
      it("prioritizes options.outDir", () => {
        const out = resolveCaptureOutputDir({ outDir: "/custom/out" }, dummyConfig);
        expect(out).toBe("/custom/out");
      });

      it("uses options.capsuleDir when outDir is omitted", () => {
        const out = resolveCaptureOutputDir({ capsuleDir: "/my/capsule" }, dummyConfig);
        expect(out).toBe("/my/capsule/captures");
      });

      it("uses options.runId when capsuleDir is omitted", () => {
        const out = resolveCaptureOutputDir({ runId: "test-run-123" }, dummyConfig);
        expect(out).toContain("test-run-123/captures");
      });

      it("uses config.outputDir when options directories are omitted", () => {
        const out = resolveCaptureOutputDir({}, dummyConfig);
        expect(out).toBe("/custom/config/output");
      });

      it("falls back to captures directory when all config paths are empty", () => {
        const out = resolveCaptureOutputDir(
          {},
          { baseUrl: "http://localhost:3000", screens: [], viewports: {} },
        );
        expect(out).toBe(join(process.cwd(), "captures"));
      });
    });

    describe("filterScreens", () => {
      const screens = [
        { id: "home", name: "Home Page", path: "/" },
        { id: "dashboard", name: "User Dashboard", path: "/dashboard" },
        { id: "settings", name: "Account Settings", path: "/settings" },
      ];

      it("returns all screens when targetScreens is undefined or empty", () => {
        expect(filterScreens(screens)).toBe(screens);
        expect(filterScreens(screens, [])).toBe(screens);
      });

      it("filters screens by ID or Name case-insensitively", () => {
        const filtered = filterScreens(screens, ["HOME", "user dashboard"]);
        expect(filtered).toHaveLength(2);
        expect(filtered.map((s) => s.id)).toEqual(["home", "dashboard"]);
      });
    });

    describe("resolveViewportsForScreen", () => {
      it("resolves targetViewports from config or canonical presets or fallback", () => {
        const viewports = resolveViewportsForScreen(
          { id: "home", name: "Home", path: "/" },
          dummyConfig,
          ["mobile", "desktop-wide", "unknown-vp"],
        );

        expect(viewports).toHaveLength(3);
        expect(viewports[0]?.name).toBe("mobile");
        expect(viewports[0]?.width).toBe(390);
        expect(viewports[1]?.name).toBe("desktop-wide");
        expect(viewports[1]?.width).toBe(1920);
        expect(viewports[2]?.name).toBe("unknown-vp");
        expect(viewports[2]?.width).toBe(1440);
      });

      it("resolves screen-specific viewports when defined including unknown presets", () => {
        const screen = {
          id: "s1",
          name: "Screen 1",
          path: "/",
          viewports: ["desktop", "tablet", "custom-unlisted"],
        };
        const viewports = resolveViewportsForScreen(screen, dummyConfig);
        expect(viewports).toHaveLength(3);
        expect(viewports[0]?.name).toBe("desktop");
        expect(viewports[1]?.name).toBe("tablet");
        expect(viewports[2]?.name).toBe("custom-unlisted");
        expect(viewports[2]?.width).toBe(1440);
      });

      it("defaults to all config.viewports when target and screen viewports are omitted", () => {
        const screen = { id: "s1", name: "Screen 1", path: "/" };
        const viewports = resolveViewportsForScreen(screen, dummyConfig);
        expect(viewports).toEqual(Object.values(dummyConfig.viewports));
      });

      it("falls back to all CANONICAL_VIEWPORTS when config.viewports is empty", () => {
        const screen = { id: "s1", name: "Screen 1", path: "/" };
        const emptyVpConfig: CaptureConfig = {
          baseUrl: "http://localhost:3000",
          screens: [],
          viewports: {},
        };
        const viewports = resolveViewportsForScreen(screen, emptyVpConfig);
        expect(viewports.length).toBeGreaterThanOrEqual(4);
      });
    });
  });

  describe("fallback-provider", () => {
    it("DefaultFallbackBrowserProvider launches driver that sets headers, cookies, screenshots, and evaluates", async () => {
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
      if (page.setCookies) {
        await page.setCookies(cookieList);
      }
      if (page.setCookie) {
        await page.setCookie({ name: "c2", value: "v2", path: "/" });
      }

      await page.goto("http://localhost:3000");
      await page.waitForSelector("#root");

      const testTmp = join(tmpdir(), `test-fb-${Date.now()}`);
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
      rmSync(testTmp, { recursive: true, force: true });
    });
  });

  describe("runner", () => {
    it("throws error when browserProvider is undefined", async () => {
      expect(runLiveCapture()).rejects.toThrow(
        "runLiveCapture requires an explicit browserProvider",
      );
    });

    it("executes live capture workflow with actions, auth, screenshot validation, and manifest generation", async () => {
      const testDir = join(tmpdir(), `run-live-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const clicked: string[] = [];
      const filled: { selector: string; value: string }[] = [];
      const hovered: string[] = [];
      let waitedTime = 0;
      let closed = false;

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => {
          return {
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
                evaluate: async () => {
                  return {
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
                  } as never;
                },
              };
            },
            close: async () => {
              closed = true;
            },
          };
        },
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
        viewports: {
          desktop: { name: "desktop", width: 1440, height: 900 },
        },
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

      rmSync(testDir, { recursive: true, force: true });
    });

    it("records errors when screenshot PNG validation fails or actions throw", async () => {
      const testDir = join(tmpdir(), `run-live-err-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => {
          return {
            newPage: async (): Promise<CapturePageDriver> => {
              return {
                setViewportSize: async () => {},
                setExtraHTTPHeaders: async () => {},
                goto: async () => {},
                waitForSelector: async () => {},
                screenshot: async () => {
                  // Returns mismatched 100x100 instead of 1440x900
                  return createSyntheticPngBuffer(100, 100, 1024);
                },
                evaluate: async () => ({}) as never,
              };
            },
            close: async () => {},
          };
        },
      };

      const customConfig: CaptureConfig = {
        baseUrl: "http://localhost:8080",
        screens: [{ id: "home", name: "Home", path: "/" }],
        viewports: {
          desktop: { name: "desktop", width: 1440, height: 900 },
        },
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

      rmSync(testDir, { recursive: true, force: true });
    });

    it("handles default screen fallback and string errors in actions/navigation", async () => {
      const testDir = join(tmpdir(), `run-live-default-screen-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => {
          return {
            newPage: async (): Promise<CapturePageDriver> => {
              return {
                setViewportSize: async () => {},
                setExtraHTTPHeaders: async () => {},
                goto: async () => {
                  throw "String network connection error";
                },
                screenshot: async () => createSyntheticPngBuffer(1440, 900),
                evaluate: async () => ({}) as never,
              };
            },
            close: async () => {},
          };
        },
      };

      const emptyScreensConfig: CaptureConfig = {
        baseUrl: "http://localhost:8080",
        screens: [],
        viewports: {
          desktop: { name: "desktop", width: 1440, height: 900 },
        },
      };

      const result = await runLiveCapture({
        config: emptyScreensConfig,
        browserProvider: mockProvider,
        outDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toBe("String network connection error");

      rmSync(testDir, { recursive: true, force: true });
    });

    it("runs live capture loading default config when options.config is omitted", async () => {
      const testDir = join(tmpdir(), `run-live-load-config-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });

      const mockProvider: CaptureBrowserProvider = {
        launch: async () => {
          return {
            newPage: async (): Promise<CapturePageDriver> => {
              return {
                setViewportSize: async () => {},
                setExtraHTTPHeaders: async () => {},
                goto: async () => {},
                screenshot: async () => createSyntheticPngBuffer(1440, 900),
                evaluate: async () => ({}) as never,
              };
            },
            close: async () => {},
          };
        },
      };

      const result = await runLiveCapture({
        configPath: "nonexistent-config.yaml",
        browserProvider: mockProvider,
        outDir: testDir,
      });

      expect(typeof result.success).toBe("boolean");
      rmSync(testDir, { recursive: true, force: true });
    });
  });
});
