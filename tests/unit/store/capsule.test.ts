import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { CAPSULE_LAYOUT } from "../../../orchestrating-long-tasks/scripts/src/store/layout.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-capsule-"));
  roots.push(root);
  return root;
}

describe("initRun", () => {
  test("materializes the full declared capsule layout for a valid request", () => {
    const repo = scratchRoot();
    const prompt = new TextEncoder().encode("do the thing");
    const runRoot = initRun(repo, "my-run", prompt, "file", true);
    expect(runRoot).toBe(join(realpathSync(repo), ".capsules", "my-run"));
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
    const repo = scratchRoot();
    const runRoot = initRun(repo, ".capsules/prefixed-run", new Uint8Array(), "file", true);
    expect(runRoot).toBe(join(realpathSync(repo), ".capsules", "prefixed-run"));
  });

  test("rejects a run id that fails RUN_ID_PATTERN even though normalizeRunId accepted it", () => {
    const repo = scratchRoot();
    expect(() => initRun(repo, "not a valid slug!", new Uint8Array(), "file", true)).toThrow(
      /run_id must be a 1-128 character slug/,
    );
  });

  test("rejects an unsupported capture_mode before touching the filesystem", () => {
    const repo = scratchRoot();
    expect(() => initRun(repo, "run", new Uint8Array(), "bogus", true)).toThrow(
      /unsupported capture_mode/,
    );
    expect(existsSync(join(repo, ".capsules"))).toBe(false);
  });

  test("rejects a prompt that is not a Uint8Array", () => {
    const repo = scratchRoot();
    expect(() => initRun(repo, "run", "not-bytes" as unknown as Uint8Array, "file", true)).toThrow(
      /prompt must be bytes/,
    );
  });

  test("rejects a non-boolean source_verified", () => {
    const repo = scratchRoot();
    expect(() =>
      initRun(repo, "run", new Uint8Array(), "file", "yes" as unknown as boolean),
    ).toThrow(/source_verified must be a bool/);
  });

  test("propagates a HarnessError when captureAssurance rejects the mode/verified combination", () => {
    const repo = scratchRoot();
    expect(() => initRun(repo, "run", new Uint8Array(), "file", false)).toThrow(HarnessError);
  });

  test("rejects a repo_root that does not exist or is not a directory", () => {
    const missing = join(tmpdir(), `store-capsule-missing-${Date.now()}`);
    expect(() => initRun(missing, "run", new Uint8Array(), "file", true)).toThrow(
      /repo_root must be a directory/,
    );
    const repo = scratchRoot();
    const fileNotDir = join(repo, "not-a-directory");
    writeFileSync(fileNotDir, "x");
    expect(() => initRun(fileNotDir, "run", new Uint8Array(), "file", true)).toThrow(
      /repo_root must be a directory/,
    );
  });

  test("throws without wrapping when the run directory already exists", () => {
    const repo = scratchRoot();
    initRun(repo, "duplicate-run", new Uint8Array(), "file", true);
    expect(() => initRun(repo, "duplicate-run", new Uint8Array(), "file", true)).toThrow();
  });

  test("removes the partially created run directory when initialization fails partway through", () => {
    const repo = scratchRoot();
    const source = join(repo, "missing-runtime-source");
    expect(() =>
      initRun(repo, "failed-run", new Uint8Array(), "file", true, { runtimeSource: source }),
    ).toThrow();
    expect(existsSync(join(repo, ".capsules", "failed-run"))).toBe(false);
  });

  function runtimeFixture(withEntrypoint: boolean): string {
    const source = mkdtempSync(join(tmpdir(), "store-capsule-runtime-"));
    roots.push(source);
    if (withEntrypoint) writeFileSync(join(source, "harness.ts"), "export {};\n");
    else writeFileSync(join(source, "package.json"), "{}\n");
    return source;
  }

  test("pins a runtime source with an entrypoint and records it in the manifest", () => {
    const repo = scratchRoot();
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
    const repo = scratchRoot();
    const source = runtimeFixture(false);
    const runRoot = initRun(repo, "runtime-run-2", new Uint8Array(), "file", true, {
      runtimeSource: source,
    });
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf-8"));
    expect(manifest.runtime_sha256).toBeDefined();
    expect("runtime_entrypoint" in manifest).toBe(false);
  });

  test("invokes beforeRuntimeSourceRecheck exactly once when copying a pinned runtime", () => {
    const repo = scratchRoot();
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
    const repo = scratchRoot();
    const runRoot = initRun(repo, "no-runtime-run", new Uint8Array(), "file", true);
    const manifest = JSON.parse(readFileSync(join(runRoot, "manifest.json"), "utf-8"));
    expect("runtime_sha256" in manifest).toBe(false);
    expect("runtime_entrypoint" in manifest).toBe(false);
  });
});
