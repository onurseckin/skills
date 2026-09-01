import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { captureInitCommand } from "../../../olt/scripts/src/cli/commands/capture-init.ts";
import {
  CAPTURE_RUN_MISSING_PROVIDER_FIX,
  CAPTURE_RUN_MISSING_PROVIDER_MESSAGE,
  captureRunCommand,
} from "../../../olt/scripts/src/cli/commands/capture-run.ts";
import { captureEvalCommand } from "../../../olt/scripts/src/cli/commands/capture-eval.ts";
import { capabilityManifest, commandSlice } from "../../../olt/scripts/src/cli/manifest.ts";
import { cleanupVirtualCaptureFS, scratchRoot, setupVirtualCaptureFS } from "../fixture.ts";

describe("T-CAP-CLI-TESTS: Harness CLI Capture Commands Integration", () => {
  beforeEach(() => {
    setupVirtualCaptureFS();
  });

  afterEach(() => {
    cleanupVirtualCaptureFS();
  });
  describe("capture:init", () => {
    it("initializes standard YAML capture config with presets", async () => {
      const root = scratchRoot(import.meta.path, "cli-init-yaml");
      const tempDir = join(root, "config-dir");
      mkdirSync(tempDir, { recursive: true });

      const res = await captureInitCommand({ "config-dir": tempDir, format: "yaml" });
      expect(res.status).toBe("initialized");
      const targetPath = join(tempDir, ".capture.yaml");
      expect(existsSync(targetPath)).toBe(true);

      const content = readFileSync(targetPath, "utf-8");
      expect(content).toContain('version: "1.0"');
      expect(content).toContain('baseUrl: "http://localhost:3000"');
      expect(content).toContain("desktop:");
      expect(content).toContain("mobile:");
    });

    it("initializes JSON config and rejects existing file without force", async () => {
      const root = scratchRoot(import.meta.path, "cli-init-json");
      const tempDir = join(root, "config-dir");
      mkdirSync(tempDir, { recursive: true });

      const res = await captureInitCommand({ "config-dir": tempDir, format: "json" });
      expect(res.status).toBe("initialized");
      const targetPath = join(tempDir, ".capture.json");
      expect(existsSync(targetPath)).toBe(true);

      const parsed = JSON.parse(readFileSync(targetPath, "utf-8"));
      expect(parsed.version).toBe("1.0");
      expect(parsed.screens.length).toBeGreaterThan(0);

      // Attempt overwrite without force should reject
      let threw = false;
      try {
        await captureInitCommand({ "config-dir": tempDir, format: "json" });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      // Overwrite with force should succeed
      const forceRes = await captureInitCommand({
        "config-dir": tempDir,
        format: "json",
        force: true,
      });
      expect(forceRes.status).toBe("initialized");
    });
  });

  describe("capture:run", () => {
    it("refuses to execute without a real browser automation driver, reporting a clear actionable error instead of fabricating evidence", async () => {
      const root = scratchRoot(import.meta.path, "cli-run-test");
      const tempDir = join(root, "run-dir");
      mkdirSync(tempDir, { recursive: true });

      const configContent = `
version: "1.0"
baseUrl: "http://localhost:3000"
viewports:
  desktop:
    name: "desktop"
    width: 1440
    height: 900
  mobile:
    name: "mobile"
    width: 375
    height: 667
screens:
  - id: "home"
    name: "Home Screen"
    path: "/"
    viewports:
      - "desktop"
      - "mobile"
`;
      const configPath = join(tempDir, ".capture.yaml");
      writeFileSync(configPath, configContent, "utf-8");

      const outDir = join(tempDir, "output");

      let caught: unknown;
      try {
        await captureRunCommand({
          config: configPath,
          "out-dir": outDir,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HarnessError);
      const harnessErr = caught as HarnessError;
      expect(harnessErr.code).toBe("NOT_IMPLEMENTED");
      expect(harnessErr.message).toBe(CAPTURE_RUN_MISSING_PROVIDER_MESSAGE);
      expect(harnessErr.fix).toBe(CAPTURE_RUN_MISSING_PROVIDER_FIX);

      expect(existsSync(join(outDir, "home-desktop.png"))).toBe(false);
      expect(existsSync(join(outDir, "home-mobile.png"))).toBe(false);
    });
  });

  describe("capture:eval", () => {
    it("evaluates certified companion manifests with 0 defects", async () => {
      const root = scratchRoot(import.meta.path, "cli-eval-cert");
      const tempDir = join(root, "eval-dir");
      mkdirSync(tempDir, { recursive: true });

      const manifestData = {
        version: "2.0",
        screenId: "clean-screen",
        viewport: "desktop",
        timestamp: new Date().toISOString(),
        elements: [
          {
            selector: "#hero-title",
            tagName: "H1",
            text: "Welcome",
            bounds: { x: 100, y: 100, width: 300, height: 50 },
            computedStyles: {
              color: "#000000",
              backgroundColor: "#ffffff",
              fontSize: 24,
              fontWeight: 700,
            },
          },
        ],
      };
      const manifestPath = join(tempDir, "clean-desktop.manifest.json");
      writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");

      const res = await captureEvalCommand({ manifest: manifestPath, strict: true });
      expect(res.verdict).toBe("CERTIFIED");
      expect(res.total_defects).toBe(0);
      expect(res.certified_manifests).toBe(1);
    });

    it("evaluates flawed companion manifests and flags defects in strict mode", async () => {
      const root = scratchRoot(import.meta.path, "cli-eval-flawed");
      const tempDir = join(root, "eval-dir");
      mkdirSync(tempDir, { recursive: true });

      const manifestData = {
        version: "2.0",
        screenId: "bad-screen",
        viewport: "desktop",
        timestamp: new Date().toISOString(),
        elements: [
          {
            selector: "#muted-label",
            tagName: "P",
            text: "Muted low contrast",
            bounds: { x: 50, y: 50, width: 200, height: 20 },
            computedStyles: {
              color: "#d0d0d0",
              backgroundColor: "#ffffff",
              fontSize: 12,
              fontWeight: 400,
            },
          },
        ],
      };
      const manifestPath = join(tempDir, "bad-desktop.manifest.json");
      writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");

      // Non-strict mode returns DEFECTS_FOUND without throwing
      const res = await captureEvalCommand({ manifest: manifestPath, strict: false });
      expect(res.verdict).toBe("DEFECTS_FOUND");
      expect(res.total_defects).toBeGreaterThan(0);

      // Strict mode throws HarnessError
      let threw = false;
      try {
        await captureEvalCommand({ manifest: manifestPath, strict: true });
      } catch (err: unknown) {
        threw = true;
        expect(String(err)).toContain("Strict certification failed");
      }
      expect(threw).toBe(true);
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
