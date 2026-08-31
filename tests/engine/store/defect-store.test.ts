import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendCapsuleDefect,
  compactCapsuleDefects,
  loadCapsuleDefects,
  resolveCapsuleDefect,
} from "../../../olt/scripts/src/engine/store/recovery/defect-store.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { setDefectLogDependenciesForTesting } from "../../../olt/scripts/src/logging/defect-logger.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const r of tempRoots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      continue;
    }
  }
  tempRoots.length = 0;
});

function createTempRunDir(): string {
  const dir = join(process.cwd(), "coverage", "scratch", `capsule-defect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
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
        id: "defect-write-fail",
        type: "write_failure",
        observation: "durable write fails",
      });
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }

    expect(caught).toBe(expected);
    expect(readFileSync(defectsPath, "utf-8")).toBe(originalBytes);
  });

  test("compactCapsuleDefects keeps latest defect records by dedup_key", () => {
    const runRoot = createTempRunDir();
    const line1 = JSON.stringify({ id: "defect-1", dedup_key: "key-1", type: "type_a", observation: "First", count: 1 });
    const line2 = JSON.stringify({ id: "defect-2", dedup_key: "key-1", type: "type_a", observation: "Second", count: 1 });
    writeFileSync(join(runRoot, "defects.jsonl"), `${line1}\n${line2}\n`);

    const result = compactCapsuleDefects(runRoot);
    expect(result.totalBefore).toBe(2);
    expect(result.totalAfter).toBe(1);

    const defects = loadCapsuleDefects(runRoot);
    expect(defects.length).toBe(1);
    expect(defects[0]?.count).toBe(2);
  });

  test("resolveCapsuleDefect updates status of matched defect", () => {
    const runRoot = createTempRunDir();
    appendCapsuleDefect(runRoot, {
      id: "defect-to-resolve",
      dedup_key: "res-key-1",
      type: "type_r",
      observation: "Needs fix",
    });

    const resolution = {
      task_id: "task-fix-1",
      test_assertion: "passes verification",
      resolved_at: new Date().toISOString(),
      verified_by: "validator",
      remediation_notes: "Fixed cleanly",
    };

    const resolved = resolveCapsuleDefect(runRoot, "res-key-1", resolution);
    expect(resolved).not.toBeNull();
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolution).toBeDefined();

    const loaded = loadCapsuleDefects(runRoot);
    expect(loaded[0]?.status).toBe("resolved");
  });

  test("throws HarnessError on invalid arguments", () => {
    expect(() => appendCapsuleDefect("", { id: "d-1", type: "t" })).toThrow(HarnessError);
    expect(() =>
      resolveCapsuleDefect("", "key", {
        task_id: "t-1",
        test_assertion: "test",
        resolved_at: new Date().toISOString(),
      }),
    ).toThrow(HarnessError);
  });
});
