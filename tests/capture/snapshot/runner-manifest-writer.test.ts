import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureConfig } from "../../../olt/scripts/src/capture/config/types.ts";
import {
  createEmptyDomPhysicsSnapshot,
  createSyntheticPngBuffer,
  DefaultFallbackBrowserProvider,
  runLiveCapture,
  type CaptureBrowserDriver,
  type CaptureBrowserProvider,
  type CapturePageDriver,
  type CompanionManifest,
} from "../../../olt/scripts/src/capture/runners/index.ts";
import { scratchRoot } from "../../shared/scratch-root.ts";

describe("Live Capture Runner & Multi-Viewport Companion Manifest Writer", () => {
  test("executes multi-viewport capture and persists companion manifest alongside PNG", async () => {
    const root = scratchRoot(import.meta.path, "test-capture-runner");
    const tempDir = join(root, "output");
    mkdirSync(tempDir, { recursive: true });

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

    const result = await runLiveCapture({
      config: testConfig,
      outDir: tempDir,
      browserProvider: new DefaultFallbackBrowserProvider(),
    });
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
  });

  test("executes custom actions cleanly", async () => {
    const root = scratchRoot(import.meta.path, "test-capture-actions");
    const tempDir = join(root, "output");
    mkdirSync(tempDir, { recursive: true });

    const actionsExecuted: string[] = [];
    const customProvider: CaptureBrowserProvider = {
      launch: async (): Promise<CaptureBrowserDriver> => ({
        newPage: async (): Promise<CapturePageDriver> => ({
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async () => createSyntheticPngBuffer(1440, 900),
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
  });

  test("persists visual evidence to active capsule and scratch root", async () => {
    const root = scratchRoot(import.meta.path, "test-capture-proof");
    const tempDir = join(root, "output");
    mkdirSync(tempDir, { recursive: true });

    const testConfig: CaptureConfig = {
      version: "1.0",
      baseUrl: "http://localhost:3000",
      viewports: { desktop: { name: "desktop", width: 1440, height: 900 } },
      screens: [{ id: "runner-visual-proof", name: "Runner Visual Proof", path: "/proof" }],
    };
    const result = await runLiveCapture({
      config: testConfig,
      outDir: tempDir,
      browserProvider: new DefaultFallbackBrowserProvider(),
    });
    expect(result.success).toBe(true);
    const proofPng = join(tempDir, "runner-visual-proof-desktop.png");
    const proofManifest = join(tempDir, "runner-visual-proof-desktop.manifest.json");
    expect(existsSync(proofPng)).toBe(true);
    expect(existsSync(proofManifest)).toBe(true);
  });
});
