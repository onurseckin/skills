import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendCapsuleDefect,
  compactCapsuleDefects,
  loadCapsuleDefects,
  resolveCapsuleDefect,
} from "../../../olt/scripts/src/engine/store/defect-store.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { setDefectLogDependenciesForTesting } from "../../../olt/scripts/src/logging/defect-logger.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const r of tempRoots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
  tempRoots.length = 0;
});

function createTempRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "capsule-run-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("Store Layer Capsule Defect Engine", () => {
  test("appends and aggregates defects in capsule run directory", () => {
    const runRoot = createTempRunDir();

    const b1 = appendCapsuleDefect(runRoot, {
      id: "defect-cap-1",
      type: "role_confinement_violation",
      category: "boundary_violation",
      observation: "Coordinator attempted to claim task",
      agent_id: "coord-01",
    });

    expect(b1.count).toBe(1);
    expect(existsSync(join(runRoot, "defects.jsonl"))).toBeTrue();

    const b2 = appendCapsuleDefect(runRoot, {
      id: "defect-cap-2",
      type: "role_confinement_violation",
      category: "boundary_violation",
      observation: "Coordinator attempted to claim task",
      agent_id: "coord-01",
    });

    expect(b2.count).toBe(2);

    const loaded = loadCapsuleDefects(runRoot);
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.count).toBe(2);
  });

  test("refuses an existing defects directory instead of returning an aggregated defect", () => {
    const runRoot = createTempRunDir();
    const defectsPath = join(runRoot, "defects.jsonl");
    const sentinelPath = join(defectsPath, "sentinel.txt");
    const sentinelBytes = "preserve-capsule-directory";
    mkdirSync(defectsPath);
    writeFileSync(sentinelPath, sentinelBytes);

    let caught: unknown;
    try {
      appendCapsuleDefect(runRoot, {
        id: "defect-directory-path",
        type: "filesystem_failure",
        observation: "defects log path is a directory",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HarnessError);
    if (caught instanceof HarnessError) {
      expect(caught.code).toBe("INTEGRITY");
      expect(caught.message).toContain("read defect log");
      expect(caught.message).toContain(defectsPath);
      expect(caught.message).toContain("EISDIR");
    }
    expect(readFileSync(sentinelPath, "utf-8")).toBe(sentinelBytes);
  });

  test("propagates a structured atomic-write failure without a fabricated capsule defect", () => {
    const runRoot = createTempRunDir();
    const defectsPath = join(runRoot, "defects.jsonl");
    const originalBytes = "prior capsule bytes\n";
    const expected = new HarnessError("INTEGRITY", "durable write failed");
    writeFileSync(defectsPath, originalBytes);
    const restore = setDefectLogDependenciesForTesting({
      atomicWrite: () => {
        throw expected;
      },
    });

    let caught: unknown;
    try {
      appendCapsuleDefect(runRoot, {
        id: "defect-atomic-failure",
        type: "filesystem_failure",
        observation: "capsule defect write failed",
      });
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }

    expect(caught).toBe(expected);
    expect(readFileSync(defectsPath, "utf-8")).toBe(originalBytes);
  });

  test("resolves a defect by ID or dedup key with resolution proof", () => {
    const runRoot = createTempRunDir();

    const b1 = appendCapsuleDefect(runRoot, {
      id: "defect-to-resolve",
      type: "code_defect",
      observation: "Missing export",
    });

    expect(b1.status).toBe("open");

    const resolved = resolveCapsuleDefect(runRoot, "defect-to-resolve", {
      task_id: "task-add-export",
      test_assertion: "bun test tests/unit/export.test.ts",
      resolved_at: "2026-08-22T08:45:00.000Z",
      commit_sha: "99887766",
    });

    expect(resolved !== null).toBeTrue();
    if (resolved) {
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe("task-add-export");
      expect(resolved.resolution?.commit_sha).toBe("99887766");
    }

    const reloaded = loadCapsuleDefects(runRoot);
    expect(reloaded[0]?.status).toBe("resolved");
  });

  test("compacts capsule defects in run directory", () => {
    const runRoot = createTempRunDir();
    const defectPath = join(runRoot, "defects.jsonl");

    const lines: string[] = [
      JSON.stringify({ id: "b1", type: "lint_error", observation: "Unused var" }),
      JSON.stringify({ id: "b2", type: "lint_error", observation: "Unused var" }),
      JSON.stringify({ id: "b3", type: "lint_error", observation: "Unused var" }),
    ];
    writeFileSync(defectPath, `${lines.join("\n")}\n`);

    const result = compactCapsuleDefects(runRoot);
    expect(result.totalBefore).toBe(3);
    expect(result.totalAfter).toBe(1);

    const reloaded = loadCapsuleDefects(runRoot);
    expect(reloaded.length).toBe(1);
    expect(reloaded[0]?.count).toBe(3);
  });

  test("handles empty or invalid runRoot parameters across all defect functions", () => {
    expect(() =>
      appendCapsuleDefect("", {
        id: "d-bad",
        type: "code_defect",
        observation: "fail",
      }),
    ).toThrow(/runRoot is required/);

    expect(loadCapsuleDefects("")).toEqual([]);

    expect(compactCapsuleDefects("")).toEqual({ totalBefore: 0, totalAfter: 0 });

    expect(() =>
      resolveCapsuleDefect("", "d-bad", {
        task_id: "t1",
        test_assertion: "true",
        resolved_at: "now",
      }),
    ).toThrow(/runRoot is required/);
  });

  test("resolveCapsuleDefect returns null when defects.jsonl does not exist or defect is not found", () => {
    const runRoot = createTempRunDir();

    // 1. File does not exist yet
    const notFound1 = resolveCapsuleDefect(runRoot, "non-existent-defect", {
      task_id: "t1",
      test_assertion: "true",
      resolved_at: "now",
    });
    expect(notFound1).toBeNull();

    // 2. File exists but defect id / key not found
    appendCapsuleDefect(runRoot, {
      id: "defect-present",
      type: "code_defect",
      observation: "Some defect",
    });

    const notFound2 = resolveCapsuleDefect(runRoot, "defect-unknown-key", {
      task_id: "t1",
      test_assertion: "true",
      resolved_at: "now",
    });
    expect(notFound2).toBeNull();
  });
});
