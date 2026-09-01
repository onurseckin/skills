import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { resolveCapsulesDir } from "../../../olt/scripts/src/core/shared/paths.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { loadRun, loadRunProjection } from "../../../olt/scripts/src/engine/store/capsule/load.ts";
import { scratchRoot } from "../store-fixture.ts";

function freshRun(label: string): string {
  const repo = scratchRoot(import.meta.path, label);
  return initRun(repo, "load-test-run", new TextEncoder().encode("prompt body"), "file", true);
}

describe("loadRun", () => {
  test("loads manifest, prompt, state and the (empty) event chain for a freshly initialized run", () => {
    const runRoot = freshRun("full-load");
    const loaded = loadRun(runRoot);
    expect(loaded.manifest.run_id).toBe("load-test-run");
    expect(new TextDecoder().decode(loaded.prompt)).toBe("prompt body");
    expect(loaded.state.revision).toBe(0);
    expect(loaded.events).toEqual([]);
    expect(loaded.runRoot).toBe(runRoot);
  });

  test("rejects a run_root that is not a real directory, such as a symlink or a plain file", () => {
    const root = scratchRoot(import.meta.path, "not-a-directory");
    const notADirectory = join(root, "not-a-directory");
    writeFileSync(notADirectory, "x");
    expect(() => loadRun(notADirectory)).toThrow(/run_root must be a real directory/);
  });

  test("throws an integrity error when verify=true and the capsule fails verification", () => {
    const runRoot = freshRun("verify-true-broken-manifest");
    rmSync(join(runRoot, "manifest.json"));
    expect(() => loadRun(runRoot)).toThrow(HarnessError);
  });

  test("skips integrity verification entirely when verify=false", () => {
    const runRoot = freshRun("verify-false-skips-integrity");
    rmSync(join(runRoot, "manifest.json"));
    // manifest.json is gone, so loading it below still fails, but for a different, later reason:
    // this proves verifyIntegrity itself was skipped rather than short-circuiting first.
    expect(() => loadRun(runRoot, false)).toThrow(/manifest\.json/);
  });

  test("throws when prompt.md is not a regular file", () => {
    const runRoot = freshRun("prompt-not-regular-file");
    rmSync(join(runRoot, "prompt.md"));
    mkdirSync(join(runRoot, "prompt.md"));
    expect(() => loadRun(runRoot, false)).toThrow(/prompt\.md is not a regular file/);
  });

  test("throws an integrity error when the event chain itself is invalid and verify=true", () => {
    const runRoot = freshRun("invalid-event-chain");
    writeFileSync(join(runRoot, "events.jsonl"), "not json\n");
    expect(() => loadRun(runRoot)).toThrow(HarnessError);
  });

  test("resolves a run relative to resolveCapsulesDir when targetPath does not exist directly", () => {
    const repo = scratchRoot(import.meta.path, "relative-load-test");
    const runId = "test-load-relative-candidate-run";
    const capsulesDir = resolveCapsulesDir(repo);
    const fullPath = join(capsulesDir, runId);
    mkdirSync(capsulesDir, { recursive: true });
    initRun(repo, runId, new TextEncoder().encode("relative body"), "file", true);
    try {
      const loaded = loadRun(runId, true, { repoRoot: repo });
      expect(loaded.manifest.run_id).toBe(runId);
    } finally {
      rmSync(fullPath, { recursive: true, force: true });
    }
  });
});

describe("loadRunProjection", () => {
  test("loads manifest and state but does not collect the event array", () => {
    const runRoot = freshRun("projection-load");
    const loaded = loadRunProjection(runRoot);
    expect(loaded.manifest.run_id).toBe("load-test-run");
    expect(loaded.events).toEqual([]);
  });

  test("always verifies integrity even without an explicit verify flag", () => {
    const runRoot = freshRun("projection-always-verifies");
    rmSync(join(runRoot, "manifest.json"));
    expect(() => loadRunProjection(runRoot)).toThrow(HarnessError);
  });
});
