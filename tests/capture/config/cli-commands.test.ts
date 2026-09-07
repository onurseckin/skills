import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { captureInitCommand } from "../../../olt/scripts/src/cli/commands/capture-init.ts";
import {
  CAPTURE_RUN_MISSING_PROVIDER_FIX,
  CAPTURE_RUN_MISSING_PROVIDER_MESSAGE,
  captureRunCommand,
} from "../../../olt/scripts/src/cli/commands/capture-run.ts";
import { capabilityManifest, commandSlice } from "../../../olt/scripts/src/cli/manifest.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualCaptureFS, scratchRoot, setupVirtualCaptureFS } from "../fixture.ts";

describe("T-CAP-CLI-TESTS: Harness CLI Capture Commands Integration", () => {
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = setupVirtualCaptureFS();
  });

  afterEach(() => {
    cleanupVirtualCaptureFS();
  });

  describe("capture:init", () => {
    it("initializes standard YAML capture config with presets", async () => {
      const root = scratchRoot(import.meta.path, "cli-init-yaml");
      const tempDir = join(root, "config-dir");
      vfs.mkdirSync(tempDir, { recursive: true });

      const res = await captureInitCommand({ "config-dir": tempDir, format: "yaml" });
      expect(res.status).toBe("initialized");
      const targetPath = join(tempDir, ".capture.yaml");
      expect(vfs.existsSync(targetPath)).toBe(true);

      const content = vfs.readFileSync(targetPath, "utf-8");
      expect(content).toContain('version: "1.0"');
      expect(content).toContain('baseUrl: "http://localhost:3000"');
      expect(content).toContain("desktop:");
      expect(content).toContain("mobile:");
    });

    it("initializes JSON config and rejects existing file without force", async () => {
      const root = scratchRoot(import.meta.path, "cli-init-json");
      const tempDir = join(root, "config-dir");
      vfs.mkdirSync(tempDir, { recursive: true });

      const res = await captureInitCommand({ "config-dir": tempDir, format: "json" });
      expect(res.status).toBe("initialized");
      const targetPath = join(tempDir, ".capture.json");
      expect(vfs.existsSync(targetPath)).toBe(true);

      const parsed = JSON.parse(vfs.readFileSync(targetPath, "utf-8"));
      expect(parsed.version).toBe("1.0");
      expect(parsed.screens.length).toBeGreaterThan(0);

      let threw = false;
      try {
        await captureInitCommand({ "config-dir": tempDir, format: "json" });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      const forceRes = await captureInitCommand({
        "config-dir": tempDir,
        format: "json",
        force: true,
      });
      expect(forceRes.status).toBe("initialized");
    });

    it("provisions deeply nested non-existent directory trees idempotently", async () => {
      const root = scratchRoot(import.meta.path, "cli-init-nested");
      const nestedDir = join(root, "level1", "level2", "deep-configs");

      const res = await captureInitCommand({ "config-dir": nestedDir, format: "yaml" });
      expect(res.status).toBe("initialized");
      const targetPath = join(nestedDir, ".capture.yaml");
      expect(vfs.existsSync(targetPath)).toBe(true);

      let threw = false;
      try {
        await captureInitCommand({ "config-dir": nestedDir, format: "yaml" });
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("INVALID_STATE");
      }
      expect(threw).toBe(true);

      const forceRes = await captureInitCommand({
        "config-dir": nestedDir,
        format: "yaml",
        force: true,
      });
      expect(forceRes.status).toBe("initialized");
    });
  });

  describe("capture:run", () => {
    it("refuses to execute without a real browser automation driver, reporting a clear actionable error instead of fabricating evidence", async () => {
      const root = scratchRoot(import.meta.path, "cli-run-test");
      const tempDir = join(root, "run-dir");
      vfs.mkdirSync(tempDir, { recursive: true });

      const configContent = `version: "1.0"\nbaseUrl: "http://localhost:3000"\nviewports:\n  desktop:\n    name: "desktop"\n    width: 1440\n    height: 900\n  mobile:\n    name: "mobile"\n    width: 375\n    height: 667\nscreens:\n  - id: "home"\n    name: "Home Screen"\n    path: "/"\n    viewports:\n      - "desktop"\n      - "mobile"\n`;
      const configPath = join(tempDir, ".capture.yaml");
      vfs.writeFileSync(configPath, configContent, "utf-8");

      const outDir = join(tempDir, "output");

      let caught: unknown;
      try {
        await captureRunCommand({ config: configPath, "out-dir": outDir });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HarnessError);
      const harnessErr = caught as HarnessError;
      expect(harnessErr.code).toBe("NOT_IMPLEMENTED");
      expect(harnessErr.message).toBe(CAPTURE_RUN_MISSING_PROVIDER_MESSAGE);
      expect(harnessErr.fix).toBe(CAPTURE_RUN_MISSING_PROVIDER_FIX);

      expect(vfs.existsSync(join(outDir, "home-desktop.png"))).toBe(false);
      expect(vfs.existsSync(join(outDir, "home-mobile.png"))).toBe(false);
    });
  });

  describe("cli-capabilities contracts", () => {
    it("validates the cli-capabilities manifest contains standardized capture commands", () => {
      const manifest = capabilityManifest();
      const commandNames = new Set(manifest.commands.map((c) => c.name));
      expect(commandNames.has("capture:init")).toBe(true);
      expect(commandNames.has("capture:run")).toBe(true);
      expect(commandNames.has("capture:eval")).toBe(true);

      const initSlice = commandSlice("capture:init");
      expect(initSlice?.domain).toBe("capture");
      expect(initSlice?.name).toBe("capture:init");
    });
  });
});
