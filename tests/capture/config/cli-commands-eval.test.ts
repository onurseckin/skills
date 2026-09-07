import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { captureEvalCommand } from "../../../olt/scripts/src/cli/commands/capture-eval.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualCaptureFS, scratchRoot, setupVirtualCaptureFS } from "../fixture.ts";

describe("T-CAP-CLI-TESTS: Harness CLI Capture Eval Integration", () => {
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = setupVirtualCaptureFS();
  });

  afterEach(() => {
    cleanupVirtualCaptureFS();
  });

  describe("capture:eval", () => {
    it("evaluates certified companion manifests with 0 defects", async () => {
      const root = scratchRoot(import.meta.path, "cli-eval-cert");
      const tempDir = join(root, "eval-dir");
      vfs.mkdirSync(tempDir, { recursive: true });

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
      vfs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");

      const res = await captureEvalCommand({ manifest: manifestPath, strict: true });
      expect(res.verdict).toBe("CERTIFIED");
      expect(res.total_defects).toBe(0);
      expect(res.certified_manifests).toBe(1);
    });

    it("evaluates flawed companion manifests and flags defects in strict mode", async () => {
      const root = scratchRoot(import.meta.path, "cli-eval-flawed");
      const tempDir = join(root, "eval-dir");
      vfs.mkdirSync(tempDir, { recursive: true });

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
      vfs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");

      const res = await captureEvalCommand({ manifest: manifestPath, strict: false });
      expect(res.verdict).toBe("DEFECTS_FOUND");
      expect(res.total_defects).toBeGreaterThan(0);

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
      vfs.mkdirSync(subDir, { recursive: true });

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

      vfs.writeFileSync(
        join(baseDir, "root.manifest.json"),
        JSON.stringify(cleanManifest),
        "utf-8",
      );
      vfs.writeFileSync(
        join(subDir, "nested.manifest.json"),
        JSON.stringify(nestedManifest),
        "utf-8",
      );
      vfs.writeFileSync(join(subDir, "readme.txt"), "some notes", "utf-8");

      const res = await captureEvalCommand({ "manifest-dir": baseDir, strict: true });
      expect(res.verdict).toBe("CERTIFIED");
      expect(res.total_defects).toBe(0);
      expect(res.certified_manifests).toBe(2);
    });

    it("handles malformed and corrupt manifests by throwing INVALID_ARGUMENT without descriptor leakage", async () => {
      const root = scratchRoot(import.meta.path, "cli-eval-corrupt");
      const tempDir = join(root, "corrupt-dir");
      vfs.mkdirSync(tempDir, { recursive: true });

      const corruptPath = join(tempDir, "broken.manifest.json");
      vfs.writeFileSync(corruptPath, "{ invalid json syntax: true", "utf-8");

      let caught: unknown;
      try {
        await captureEvalCommand({ manifest: corruptPath });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HarnessError);
      expect((caught as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((caught as HarnessError).message).toContain("Failed to parse manifest JSON");

      const emptyPath = join(tempDir, "empty.manifest.json");
      vfs.writeFileSync(emptyPath, "", "utf-8");

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
});
