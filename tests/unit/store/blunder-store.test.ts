import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendCapsuleBlunder,
  compactCapsuleBlunders,
  loadCapsuleBlunders,
  resolveCapsuleBlunder,
} from "../../../orchestrating-long-tasks/scripts/src/store/blunder-store.ts";

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

describe("Store Layer Capsule Blunder Engine", () => {
  test("appends and aggregates blunders in capsule run directory", () => {
    const runRoot = createTempRunDir();

    const b1 = appendCapsuleBlunder(runRoot, {
      id: "blunder-cap-1",
      type: "role_confinement_violation",
      category: "boundary_violation",
      observation: "Coordinator attempted to claim task",
      agent_id: "coord-01",
    });

    expect(b1.count).toBe(1);
    expect(existsSync(join(runRoot, "blunders.jsonl"))).toBeTrue();

    const b2 = appendCapsuleBlunder(runRoot, {
      id: "blunder-cap-2",
      type: "role_confinement_violation",
      category: "boundary_violation",
      observation: "Coordinator attempted to claim task",
      agent_id: "coord-01",
    });

    expect(b2.count).toBe(2);

    const loaded = loadCapsuleBlunders(runRoot);
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.count).toBe(2);
  });

  test("resolves a blunder by ID or dedup key with resolution proof", () => {
    const runRoot = createTempRunDir();

    const b1 = appendCapsuleBlunder(runRoot, {
      id: "blunder-to-resolve",
      type: "code_defect",
      observation: "Missing export",
    });

    expect(b1.status).toBe("open");

    const resolved = resolveCapsuleBlunder(runRoot, "blunder-to-resolve", {
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

    const reloaded = loadCapsuleBlunders(runRoot);
    expect(reloaded[0]?.status).toBe("resolved");
  });

  test("compacts capsule blunders in run directory", () => {
    const runRoot = createTempRunDir();
    const blunderPath = join(runRoot, "blunders.jsonl");

    const lines: string[] = [
      JSON.stringify({ id: "b1", type: "lint_error", observation: "Unused var" }),
      JSON.stringify({ id: "b2", type: "lint_error", observation: "Unused var" }),
      JSON.stringify({ id: "b3", type: "lint_error", observation: "Unused var" }),
    ];
    writeFileSync(blunderPath, `${lines.join("\n")}\n`);

    const result = compactCapsuleBlunders(runRoot);
    expect(result.totalBefore).toBe(3);
    expect(result.totalAfter).toBe(1);

    const reloaded = loadCapsuleBlunders(runRoot);
    expect(reloaded.length).toBe(1);
    expect(reloaded[0]?.count).toBe(3);
  });
});
