import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryQueryCommand } from "../../../olt/scripts/src/cli/commands/memory-ops.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "./fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./fixtures/task-ops-fixture.ts";

const roots: string[] = [];

describe("memory:query CLI Command Coverage Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(async () => {
    await cleanupRoots(roots);
    cleanupVirtualCliFS();
  });

  test("memoryQueryCommand validates flags, now timestamp, query requirement, and min-score", async () => {
    const { repo, run } = await setupCompiledRun("mem-val", roots);

    // 1. Invalid flag rejection via assertFlags
    expect(() =>
      memoryQueryCommand({
        "unrecognized-flag": "bad",
      }),
    ).toThrow();

    // 2. Invalid now timestamp
    expect(() =>
      memoryQueryCommand({
        query: "test",
        now: "invalid-timestamp",
      }),
    ).toThrow("invalid --now timestamp: invalid-timestamp");

    // 3. Blank query and no filters or run
    expect(() =>
      memoryQueryCommand({
        query: "   ",
      }),
    ).toThrow("--query must have a non-blank value");

    expect(() => memoryQueryCommand({})).toThrow("--query must have a non-blank value");

    // 4. Invalid min-score (negative or non-number)
    expect(() =>
      memoryQueryCommand({
        query: "test",
        "min-score": "-0.5",
      }),
    ).toThrow("invalid --min-score: -0.5; must be a non-negative number");

    expect(() =>
      memoryQueryCommand({
        query: "test",
        "min-score": "abc",
      }),
    ).toThrow("invalid --min-score: abc; must be a non-negative number");

    // 5. Non-existent repo root
    expect(() =>
      memoryQueryCommand({
        query: "test",
        repo: "/non/existent/repo/path",
      }),
    ).toThrow("repository root not found: /non/existent/repo/path");

    // 6. Non-existent capsules dir
    expect(() =>
      memoryQueryCommand({
        query: "test",
        "capsules-dir": "/non/existent/capsules/dir",
      }),
    ).toThrow("capsules directory not found: /non/existent/capsules/dir");
  });

  test("memoryQueryCommand supports inlinePrompt from CommandContext as query fallback", async () => {
    const { repo } = await setupCompiledRun("mem-ctx", roots);

    const res = memoryQueryCommand(
      {
        repo,
      },
      {
        inlinePrompt: "architecture guidelines",
      },
    );

    expect(res.query).toBe("architecture guidelines");
    expect(res.total_indexed).toBeGreaterThanOrEqual(0);
    expect(typeof res.markdown).toBe("string");
  });

  test("memoryQueryCommand resolves query when filters or run are provided without explicit query", async () => {
    const { repo, run } = await setupCompiledRun("mem-noquery", roots);

    const res = memoryQueryCommand({
      repo,
      run,
      kind: "task",
      gen: "1",
      tag: "core",
      pattern: "*.*",
      limit: 5,
      "min-score": "0.1",
      all: true,
      now: "2026-09-01T12:00:00.000Z",
    });

    expect(res.query).toBe("");
    expect(res.kind_filter).toBe("task");
    expect(res.generation_filter).toBe("1");
    expect(res.tags_filter).toBe("core");
    expect(res.pattern_filter).toBe("*.*");
    expect(res.run_root).toBe(run);
    expect(typeof res.markdown).toBe("string");
  });

  test("memoryQueryCommand supports generation and tags aliases", async () => {
    const { repo } = await setupCompiledRun("mem-aliases", roots);

    const res = memoryQueryCommand({
      repo,
      query: "task",
      generation: "2",
      tags: "perf,sec",
    });

    expect(res.generation_filter).toBe("2");
    expect(res.tags_filter).toBe("perf,sec");
  });

  test("memoryQueryCommand tests capsule directory resolution variations", async () => {
    const { repo } = await setupCompiledRun("mem-cap-res", roots);

    // Variation A: capsulesDirFlag provided
    const customCapsDir = join(repo, "custom-caps");
    mkdirSync(customCapsDir, { recursive: true });
    const resA = memoryQueryCommand({
      repo,
      query: "sample",
      "capsules-dir": customCapsDir,
    });
    expect(resA.capsules_dir).toBe(customCapsDir);

    // Variation B: run is located inside a .capsules directory
    const nestedCapsDir = join(repo, ".capsules");
    const nestedRun = join(nestedCapsDir, "run-in-caps");
    mkdirSync(nestedRun, { recursive: true });
    writeFileSync(join(nestedRun, "manifest.json"), JSON.stringify({ run_id: "run-in-caps" }));
    const resB = memoryQueryCommand({
      repo,
      query: "sample",
      run: nestedRun,
    });
    expect(resB.capsules_dir).toBe(nestedCapsDir);

    // Variation C: run directory contains a child .capsules directory
    const parentRun = join(repo, "parent-run");
    const childCapsDir = join(parentRun, ".capsules");
    mkdirSync(childCapsDir, { recursive: true });
    const resC = memoryQueryCommand({
      repo,
      query: "sample",
      run: parentRun,
    });
    expect(resC.capsules_dir).toBe(childCapsDir);

    // Variation D: run directory with standard parent fallback
    const plainRun = join(repo, "plain-run");
    mkdirSync(plainRun, { recursive: true });
    const resD = memoryQueryCommand({
      repo,
      query: "sample",
      run: plainRun,
    });
    expect(resD.capsules_dir).toBe(repo);
  });
});
