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

    it("provisions deeply nested non-existent directory trees idempotently", async () => {
      const root = scratchRoot(import.meta.path, "cli-init-nested");
      const nestedDir = join(root, "level1", "level2", "deep-configs");

      // Verify provision in non-existent nested path
      const res = await captureInitCommand({ "config-dir": nestedDir, format: "yaml" });
      expect(res.status).toBe("initialized");
      const targetPath = join(nestedDir, ".capture.yaml");
      expect(existsSync(targetPath)).toBe(true);

      // Second attempt without force must throw HarnessError("INVALID_STATE")
      let threw = false;
      try {
        await captureInitCommand({ "config-dir": nestedDir, format: "yaml" });
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("INVALID_STATE");
      }
      expect(threw).toBe(true);

      // Force overwrite should succeed
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

    it("recursively traverses in-memory VFS directory trees with --manifest-dir", async () => {
      const root = scratchRoot(import.meta.path, "cli-eval-dir");
      const baseDir = join(root, "manifests");
      const subDir = join(baseDir, "nested", "sub");
      mkdirSync(subDir, { recursive: true });

      const cleanManifest = {
        version: "2.0",
        screenId: "screen-1",
        viewport: "desktop",
        elements: [
          {
            selector: "#title-1",
            tagName: "H1",
            bounds: { x: 0, y: 0, width: 200, height: 40 },
            computedStyles: { color: "#000000", backgroundColor: "#ffffff" },
          },
        ],
      };

      const nestedManifest = {
        version: "2.0",
        screenId: "screen-2",
        viewport: "mobile",
        elements: [
          {
            selector: "#title-2",
            tagName: "H2",
            bounds: { x: 0, y: 0, width: 100, height: 30 },
            computedStyles: { color: "#000000", backgroundColor: "#ffffff" },
          },
        ],
      };

      writeFileSync(join(baseDir, "root.manifest.json"), JSON.stringify(cleanManifest), "utf-8");
      writeFileSync(join(subDir, "nested.manifest.json"), JSON.stringify(nestedManifest), "utf-8");
      // Add non-manifest file that should be ignored by directory scanner
      writeFileSync(join(subDir, "readme.txt"), "some notes", "utf-8");

      const res = await captureEvalCommand({ "manifest-dir": baseDir, strict: true });
      expect(res.verdict).toBe("CERTIFIED");
      expect(res.total_defects).toBe(0);
      expect(res.certified_manifests).toBe(2);
    });

    it("handles malformed and corrupt manifests by throwing INVALID_ARGUMENT without descriptor leakage", async () => {
      const root = scratchRoot(import.meta.path, "cli-eval-corrupt");
      const tempDir = join(root, "corrupt-dir");
      mkdirSync(tempDir, { recursive: true });

      const corruptPath = join(tempDir, "broken.manifest.json");
      writeFileSync(corruptPath, "{ invalid json syntax: true", "utf-8");

      let caught: unknown;
      try {
        await captureEvalCommand({ manifest: corruptPath });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HarnessError);
      expect((caught as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((caught as HarnessError).message).toContain("Failed to parse manifest JSON");

      // Verify empty file also throws INVALID_ARGUMENT
      const emptyPath = join(tempDir, "empty.manifest.json");
      writeFileSync(emptyPath, "", "utf-8");

      let emptyCaught: unknown;
      try {
        await captureEvalCommand({ manifest: emptyPath });
      } catch (err) {
        emptyCaught = err;
      }
      expect(emptyCaught).toBeInstanceOf(HarnessError);
      expect((emptyCaught as HarnessError).code).toBe("INVALID_ARGUMENT");
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
