import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  captureEvalCommand,
  evaluateManifestFile,
  findManifestsInDir,
} from "../../../olt/scripts/src/cli/commands/capture-eval.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("capture-eval CLI command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `capture-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("evaluateManifestFile", () => {
    test("throws HarnessError when file does not exist", () => {
      expect(() => evaluateManifestFile(join(testDir, "missing.manifest.json"))).toThrow(
        HarnessError,
      );
    });

    test("throws HarnessError when file contains invalid JSON", () => {
      const invalidPath = join(testDir, "invalid.manifest.json");
      writeFileSync(invalidPath, "not valid json {", "utf-8");
      expect(() => evaluateManifestFile(invalidPath)).toThrow(HarnessError);
    });

    test("throws HarnessError when JSON is not an object", () => {
      const nullPath = join(testDir, "null.manifest.json");
      writeFileSync(nullPath, "null", "utf-8");
      expect(() => evaluateManifestFile(nullPath)).toThrow(HarnessError);
    });

    test("evaluates manifest with physics elements fallback and default screenId/viewport", () => {
      const manifestPath = join(testDir, "physics.manifest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          physics: {
            elements: [
              {
                id: "btn-1",
                role: "button",
                tagName: "button",
                selector: "#btn-1",
                bounds: { x: 10, y: 10, width: 100, height: 48 },
                color: "#FFFFFF",
                backgroundColor: "#000000",
                fontSize: 16,
              },
            ],
          },
        }),
        "utf-8",
      );

      const result = evaluateManifestFile(manifestPath);
      expect(result.screenId).toBe("unknown");
      expect(result.viewport).toBe("desktop");
      expect(result.verdict).toBeDefined();
    });

    test("evaluates manifest with explicit elements, screenId, and viewport", () => {
      const manifestPath = join(testDir, "valid.manifest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          screenId: "screen-home",
          viewport: "mobile",
          elements: [
            {
              id: "header-1",
              role: "heading",
              tagName: "h1",
              selector: "#header-1",
              bounds: { x: 0, y: 0, width: 375, height: 60 },
              color: "#000000",
              backgroundColor: "#FFFFFF",
              fontSize: 24,
            },
          ],
        }),
        "utf-8",
      );

      const result = evaluateManifestFile(manifestPath);
      expect(result.screenId).toBe("screen-home");
      expect(result.viewport).toBe("mobile");
    });
  });

  describe("findManifestsInDir", () => {
    test("returns empty array for non-existent directory", () => {
      expect(findManifestsInDir(join(testDir, "non-existent"))).toEqual([]);
    });

    test("finds .manifest.json files recursively and ignores hidden dirs", () => {
      const subDir = join(testDir, "sub");
      const hiddenDir = join(testDir, ".hidden");
      mkdirSync(subDir, { recursive: true });
      mkdirSync(hiddenDir, { recursive: true });

      const file1 = join(testDir, "a.manifest.json");
      const file2 = join(subDir, "b.manifest.json");
      const file3 = join(testDir, "c.txt");
      const fileHidden = join(hiddenDir, "hidden.manifest.json");

      writeFileSync(file1, "{}", "utf-8");
      writeFileSync(file2, "{}", "utf-8");
      writeFileSync(file3, "text", "utf-8");
      writeFileSync(fileHidden, "{}", "utf-8");

      const found = findManifestsInDir(testDir);
      expect(found).toHaveLength(2);
      expect(found).toContain(file1);
      expect(found).toContain(file2);
      expect(found).not.toContain(fileHidden);
    });
  });

  describe("captureEvalCommand", () => {
    test("throws HarnessError when neither manifest nor manifest-dir provided", async () => {
      await expect(captureEvalCommand({})).rejects.toThrow(HarnessError);
    });

    test("throws HarnessError when no .manifest.json files are found", async () => {
      await expect(
        captureEvalCommand({
          "manifest-dir": testDir,
        }),
      ).rejects.toThrow(HarnessError);
    });

    test("evaluates single manifest and reports certified verdict", async () => {
      const manifestPath = join(testDir, "screen.manifest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          screenId: "screen-main",
          viewport: "desktop",
          elements: [
            {
              id: "btn-ok",
              role: "button",
              tagName: "button",
              selector: "#btn-ok",
              bounds: { x: 20, y: 20, width: 120, height: 48 },
              color: "#000000",
              backgroundColor: "#FFFFFF",
              fontSize: 16,
              accessibleName: "OK",
            },
          ],
        }),
        "utf-8",
      );

      const result = await captureEvalCommand({
        manifest: manifestPath,
      });

      expect(result.total_manifests).toBe(1);
      expect(String(result.markdown)).toContain("4-Pillar Validation Certification Results");
      expect(result.evaluations).toBeDefined();
    });

    test("evaluates multiple manifests via manifest-dir and handles strict failure", async () => {
      const manifestPath = join(testDir, "bad.manifest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          screenId: "screen-bad",
          viewport: "desktop",
          elements: [
            {
              id: "bad-1",
              role: "button",
              tagName: "button",
              selector: "#bad-1",
              // Violates touch target size and contrast
              bounds: { x: 0, y: 0, width: 5, height: 5 },
              color: "#EEEEEE",
              backgroundColor: "#EFEFEF",
              fontSize: 8,
            },
          ],
        }),
        "utf-8",
      );

      // Non-strict evaluates with DEFECTS_FOUND
      const nonStrictResult = await captureEvalCommand({
        "manifest-dir": testDir,
        strict: false,
      });
      expect(nonStrictResult.verdict).toBe("DEFECTS_FOUND");
      expect(nonStrictResult.defects_manifests).toBe(1);

      // Strict mode throws HarnessError
      await expect(
        captureEvalCommand({
          "manifest-dir": testDir,
          strict: true,
        }),
      ).rejects.toThrow(HarnessError);
    });
  });
});
