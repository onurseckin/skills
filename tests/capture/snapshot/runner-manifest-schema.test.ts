import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CaptureConfig } from "../../../olt/scripts/src/capture/config/types.ts";
import {
  filterScreens,
  resolveCaptureOutputDir,
  resolveViewportsForScreen,
  runLiveCapture,
} from "../../../olt/scripts/src/capture/runners/index.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";

describe("Companion Manifest Resolution & Error Protection", () => {
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

  test("refuses to silently fabricate evidence when no browserProvider is supplied", async () => {
    const root = scratchRoot(import.meta.path, "test-capture-no-provider");
    const tempDir = join(root, "output");
    mkdirSync(tempDir, { recursive: true });

    const testConfig: CaptureConfig = {
      version: "1.0",
      baseUrl: "http://localhost:3000",
      viewports: { desktop: { name: "desktop", width: 1440, height: 900 } },
      screens: [{ id: "index", name: "Default Screen", path: "/" }],
    };

    let threw = false;
    try {
      await runLiveCapture({ config: testConfig, outDir: tempDir });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(existsSync(join(tempDir, "index-desktop.png"))).toBe(false);
  });
});
