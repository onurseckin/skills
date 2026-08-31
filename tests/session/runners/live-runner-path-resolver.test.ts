import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { CaptureConfig } from "../../../olt/scripts/src/capture/config/types.ts";
import {
  createSyntheticPngBuffer,
  filterScreens,
  resolveCaptureOutputDir,
  resolveViewportsForScreen,
} from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";

describe("live-capture-runner: path-resolver & synthetic png", () => {
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
});
