import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  syncDoctorFindingsToDefects,
  parseDefectsJsonl,
  cleanupVestigialDefectsFile,
  computeNormalizedFailureSignature,
} from "../../../olt/scripts/src/mind/defects/sync/index.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Wave 3 - Task 3.1: Flock-Locked Defect Store & Hash Deduplication", () => {
  test("computeNormalizedFailureSignature produces deterministic SHA-256 hash", () => {
    const hash1 = computeNormalizedFailureSignature({
      category: "linter",
      code: "AST_PURITY_VIOLATION",
      path: "src/index.ts",
      message: "Found banned as any",
      line: 42,
    });
    const hash2 = computeNormalizedFailureSignature({
      category: "LINTER",
      code: "AST_PURITY_VIOLATION",
      path: "src/index.ts",
      message: "Found banned as any",
      line: 42,
    });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("syncDoctorFindingsToDefects deduplicates repeated findings under flock lock", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "defect-sync-test-"));
    roots.push(tempDir);
    const defectsPath = join(tempDir, ".olt", "defects.jsonl");

    const finding = {
      code: "AST_PURITY_VIOLATION",
      severity: "high" as const,
      file: "src/main.ts",
      line: 10,
      message: "Prohibited any usage",
    };

    // First sync
    const res1 = syncDoctorFindingsToDefects([finding], { defectsPath });
    expect(res1.newlyCreated).toBe(1);
    expect(res1.defects.length).toBe(1);
    expect(res1.defects[0]?.count).toBe(1);

    // Second sync of same finding
    const res2 = syncDoctorFindingsToDefects([finding], { defectsPath });
    expect(res2.newlyCreated).toBe(0);
    expect(res2.existingUpdated).toBe(1);
    expect(res2.defects.length).toBe(1);
    expect(res2.defects[0]?.count).toBe(2);

    // Verify file content
    const fileContent = readFileSync(defectsPath, "utf-8");
    const parsed = parseDefectsJsonl(fileContent);
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.count).toBe(2);
  });

  test("cleanupVestigialDefectsFile removes olt/defects.jsonl and migrates to .olt/defects.jsonl", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "vestigial-test-"));
    roots.push(tempDir);

    const oltDir = join(tempDir, "olt");
    const dotOltDir = join(tempDir, ".olt");
    await mkdir(oltDir, { recursive: true });
    await mkdir(dotOltDir, { recursive: true });

    const vestigialPath = join(oltDir, "defects.jsonl");
    const canonicalPath = join(dotOltDir, "defects.jsonl");

    writeFileSync(vestigialPath, JSON.stringify({ id: "d1", code: "C1" }) + "\n");

    cleanupVestigialDefectsFile(canonicalPath);

    expect(existsSync(vestigialPath)).toBe(false);
    expect(existsSync(canonicalPath)).toBe(true);
    const content = readFileSync(canonicalPath, "utf-8");
    expect(content).toContain("d1");
  });
});
