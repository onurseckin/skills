import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { CAPSULE_LAYOUT } from "../../../olt/scripts/src/engine/store/layout/layout.ts";
import { resolveCapsulesDir } from "../../../olt/scripts/src/core/shared/paths.ts";
import { safeRmSync } from "../../../olt/scripts/src/core/shared/safe-fs/index.ts";
import { scratchRoot as makeScratchRoot } from "../store-fixture.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("initRun", () => {
  test("materializes the full declared capsule layout for a valid request", () => {
    const repo = scratchRoot("materializes-the-full-declared-capsule-layout-for-");
    const prompt = new TextEncoder().encode("do the thing");
    const runRoot = initRun(repo, "my-run", prompt, "file", true);
    expect(runRoot).toBe(join(realpathSync(repo), ".olt", "capsules", "my-run"));
    expect(readFileSync(join(runRoot, "prompt.md"))).toEqual(prompt);
    expect((statSync(join(runRoot, "prompt.md")).mode & 0o222) === 0).toBe(true);
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf-8"));
    expect(manifest.run_id).toBe("my-run");
    expect(manifest.capture_mode).toBe("file");
    expect(manifest.assurance).toBe("source-verified");
    expect(readFileSync(join(runRoot, "events.jsonl"), "utf-8")).toBe("");
    const state = JSON.parse(readFileSync(join(runRoot, "state.json"), "utf-8"));
    expect(state.revision).toBe(0);
    expect(existsSync(join(runRoot, "README.md"))).toBe(true);
    expect(existsSync(join(runRoot, "index.json"))).toBe(true);
    expect(existsSync(join(runRoot, "trace.md"))).toBe(true);
    for (const entry of CAPSULE_LAYOUT) {
      if (entry.createdAtInit && entry.name.endsWith("/")) {
        expect(existsSync(join(runRoot, entry.name.slice(0, -1)))).toBe(true);
      }
    }
  });

  test("strips a leading .capsules/ prefix from the run id before creating the directory", () => {
    const repo = scratchRoot("strips-a-leading-capsules-prefix-from-the-run-id-b");
    const runRoot = initRun(repo, ".olt/capsules/prefixed-run", new Uint8Array(), "file", true);
    expect(runRoot).toBe(join(realpathSync(repo), ".olt", "capsules", "prefixed-run"));
  });

  test("rejects a run id that fails RUN_ID_PATTERN even though normalizeRunId accepted it", () => {
    const repo = scratchRoot("rejects-a-run-id-that-fails-run-id-pattern-even-th");
    expect(() => initRun(repo, "not a valid slug!", new Uint8Array(), "file", true)).toThrow(
      /run_id must be a 1-128 character slug/,
    );
  });

  test("rejects an unsupported capture_mode before touching the filesystem", () => {
    const repo = scratchRoot("rejects-an-unsupported-capture-mode-before-touchin");
    expect(() => initRun(repo, "run", new Uint8Array(), "bogus", true)).toThrow(
      /unsupported capture_mode/,
    );
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(false);
  });

  test("rejects a prompt that is not a Uint8Array", () => {
    const repo = scratchRoot("rejects-a-prompt-that-is-not-a-uint8array");
    expect(() => initRun(repo, "run", "not-bytes" as unknown as Uint8Array, "file", true)).toThrow(
      /prompt must be bytes/,
    );
  });

  test("rejects a non-boolean source_verified", () => {
    const repo = scratchRoot("rejects-a-non-boolean-source-verified");
    expect(() =>
      initRun(repo, "run", new Uint8Array(), "file", "yes" as unknown as boolean),
    ).toThrow(/source_verified must be a bool/);
  });

  test("propagates a HarnessError when captureAssurance rejects the mode/verified combination", () => {
    const repo = scratchRoot("propagates-a-harnesserror-when-captureassurance-re");
    expect(() => initRun(repo, "run", new Uint8Array(), "file", false)).toThrow(HarnessError);
  });

  test("rejects a repo_root that does not exist or is not a directory", () => {
    const missing = join(scratchRoot("missing-repo-root"), "does-not-exist");
    expect(() => initRun(missing, "run", new Uint8Array(), "file", true)).toThrow(
      /repo_root must be a directory/,
    );
    const repo = scratchRoot("repo-root-not-a-directory");
    const fileNotDir = join(repo, "not-a-directory");
    writeFileSync(fileNotDir, "x");
    expect(() => initRun(fileNotDir, "run", new Uint8Array(), "file", true)).toThrow(
      /repo_root must be a directory/,
    );
  });

  test("throws without wrapping when the run directory already exists", () => {
    const repo = scratchRoot("throws-without-wrapping-when-the-run-directory-alr");
    initRun(repo, "duplicate-run", new Uint8Array(), "file", true);
    expect(() => initRun(repo, "duplicate-run", new Uint8Array(), "file", true)).toThrow();
  });

  test("removes the partially created run directory when initialization fails partway through", () => {
    const repo = scratchRoot("removes-the-partially-created-run-directory-when-i");
    const source = join(repo, "missing-runtime-source");
    expect(() =>
      initRun(repo, "failed-run", new Uint8Array(), "file", true, { runtimeSource: source }),
    ).toThrow();
    expect(existsSync(join(repo, ".olt", "capsules", "failed-run"))).toBe(false);
  });

  function runtimeFixture(withEntrypoint: boolean): string {
    const source = scratchRoot("runtime-source");
    if (withEntrypoint) writeFileSync(join(source, "harness.ts"), "export {};\n");
    else writeFileSync(join(source, "package.json"), "{}\n");
    return source;
  }

  test("pins a runtime source with an entrypoint and records it in the manifest", () => {
    const repo = scratchRoot("pins-a-runtime-source-with-an-entrypoint-and-recor");
    const source = runtimeFixture(true);
    const runRoot = initRun(repo, "runtime-run", new Uint8Array(), "file", true, {
      runtimeSource: source,
    });
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf-8"));
    expect(manifest.runtime_sha256).toBeDefined();
    expect(manifest.runtime_files).toBe(1);
    expect(manifest.runtime_entrypoint).toBe("runtime/harness.ts");
    expect(existsSync(join(runRoot, "runtime", "harness.ts"))).toBe(true);
  });

  test("pins a runtime source without an entrypoint and omits runtime_entrypoint from the manifest", () => {
    const repo = scratchRoot("pins-a-runtime-source-without-an-entrypoint-and-om");
    const source = runtimeFixture(false);
    const runRoot = initRun(repo, "runtime-run-2", new Uint8Array(), "file", true, {
      runtimeSource: source,
    });
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf-8"));
    expect(manifest.runtime_sha256).toBeDefined();
    expect("runtime_entrypoint" in manifest).toBe(false);
  });

  test("invokes beforeRuntimeSourceRecheck exactly once when copying a pinned runtime", () => {
    const repo = scratchRoot("invokes-beforeruntimesourcerecheck-exactly-once-wh");
    const source = runtimeFixture(true);
    let calls = 0;
    initRun(repo, "runtime-run-3", new Uint8Array(), "file", true, {
      runtimeSource: source,
      beforeRuntimeSourceRecheck: () => {
        calls += 1;
      },
    });
    expect(calls).toBe(1);
  });

  test("omits runtime_* manifest fields entirely when no runtimeSource is given", () => {
    const repo = scratchRoot("omits-runtime-manifest-fields-entirely-when-no-run");
    const runRoot = initRun(repo, "no-runtime-run", new Uint8Array(), "file", true);
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf-8"));
    expect("runtime_sha256" in manifest).toBe(false);
    expect("runtime_entrypoint" in manifest).toBe(false);
  });

  test("never deletes a pre-existing run directory when init fails because the run_id is a duplicate", () => {
    const repo = scratchRoot("never-deletes-a-pre-existing-run-directory-when-in");
    const runRoot = initRun(repo, "existing-run", new Uint8Array(), "file", true);
    const marker = join(runRoot, "marker.txt");
    writeFileSync(marker, "keep-me");

    expect(() => initRun(repo, "existing-run", new Uint8Array(), "file", true)).toThrow();

    expect(existsSync(runRoot)).toBe(true);
    expect(readFileSync(marker, "utf-8")).toBe("keep-me");
  });

  test("the failure-cleanup path refuses to delete anything outside the capsules root instead of deleting it", () => {
    const repo = scratchRoot("failure-cleanup-refuses-targets-outside-capsules-r");
    const capsulesRoot = resolveCapsulesDir(realpathSync(repo));
    mkdirSync(capsulesRoot, { recursive: true });
    const outsideTarget = join(repo, "not-a-capsule-run");
    mkdirSync(outsideTarget, { recursive: true });
    writeFileSync(join(outsideTarget, "keep.txt"), "still-here");

    expect(() => safeRmSync(outsideTarget, { allowedRoots: [capsulesRoot] })).toThrow(HarnessError);
    try {
      safeRmSync(outsideTarget, { allowedRoots: [capsulesRoot] });
    } catch (error) {
      expect((error as HarnessError).code).toBe("PATH_SAFETY");
      expect((error as HarnessError).message).toContain("CONTAINMENT");
    }

    expect(existsSync(outsideTarget)).toBe(true);
    expect(readFileSync(join(outsideTarget, "keep.txt"), "utf-8")).toBe("still-here");
  });

  test("rejects initializing a capsule inside an existing capsule workspace", () => {
    const repo = scratchRoot("rejects-nested-capsule-workspace");
    const parentRun = initRun(repo, "parent-run", new Uint8Array(), "file", true);
    expect(() => initRun(parentRun, "child-run", new Uint8Array(), "file", true)).toThrow(
      HarnessError,
    );
    try {
      initRun(parentRun, "child-run", new Uint8Array(), "file", true);
    } catch (error) {
      expect((error as HarnessError).code).toBe("PATH_SAFETY");
      expect((error as HarnessError).message).toContain(
        "cannot initialize a capsule inside an existing capsule workspace",
      );
    }
  });
});
