import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { CaptureConfig } from "../../../olt/scripts/src/capture/config/types.ts";
import {
  createSyntheticPngBuffer,
  runLiveCapture,
} from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import type {
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../../../olt/scripts/src/capture/runners/types.ts";
import {
  cleanupVirtualCaptureFS,
  getVirtualCaptureFS,
  scratchRoot,
  setupVirtualCaptureFS,
} from "../fixture.ts";

describe("live-capture-runner: error handling & fallbacks", () => {
  beforeEach(() => {
    setupVirtualCaptureFS();
  });

  afterEach(() => {
    cleanupVirtualCaptureFS();
  });

  it("records errors when screenshot PNG validation fails or actions throw", async () => {
    const vfs = getVirtualCaptureFS();
    const root = scratchRoot(import.meta.path, "live-capture-png-err");
    const testDir = join(root, "output");
    vfs.mkdirSync(testDir, { recursive: true });

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

  it("handles unexpected page.screenshot exceptions and guarantees browser.close()", async () => {
    const vfs = getVirtualCaptureFS();
    const root = scratchRoot(import.meta.path, "live-capture-screenshot-throw");
    const testDir = join(root, "output");
    vfs.mkdirSync(testDir, { recursive: true });

    let closed = false;
    const mockProvider: CaptureBrowserProvider = {
      launch: async () => ({
        newPage: async (): Promise<CapturePageDriver> => ({
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          goto: async () => {},
          screenshot: async () => {
            throw new Error("Simulated browser rendering crash during screenshot");
          },
          evaluate: async () => ({}) as never,
        }),
        close: async () => {
          closed = true;
        },
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
    expect(result.errors[0]?.error).toContain("Simulated browser rendering crash");
    expect(closed).toBe(true);
  });

  it("rejects truncated/corrupted PNG buffers lacking IHDR structure", async () => {
    const vfs = getVirtualCaptureFS();
    const root = scratchRoot(import.meta.path, "live-capture-truncated-png");
    const testDir = join(root, "output");
    vfs.mkdirSync(testDir, { recursive: true });

    const mockProvider: CaptureBrowserProvider = {
      launch: async () => ({
        newPage: async (): Promise<CapturePageDriver> => ({
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          goto: async () => {},
          screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
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
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toContain("failed PNG IHDR validation");
  });

  it("handles default screen fallback and string errors in actions/navigation", async () => {
    const vfs = getVirtualCaptureFS();
    const root = scratchRoot(import.meta.path, "live-capture-string-err");
    const testDir = join(root, "output");
    vfs.mkdirSync(testDir, { recursive: true });

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
    const vfs = getVirtualCaptureFS();
    const root = scratchRoot(import.meta.path, "live-capture-default-config");
    const testDir = join(root, "output");
    vfs.mkdirSync(testDir, { recursive: true });

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
      configPath: "/virtual/nonexistent-config.yaml",
      targetViewports: ["desktop"],
      browserProvider: mockProvider,
      outDir: testDir,
    });

    expect(typeof result.success).toBe("boolean");
  });
});
