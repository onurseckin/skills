import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity/integrity.ts";
import {
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
  symlinkSync,
} from "../store-fixture.ts";

function freshRun(label: string): string {
  const repo = scratchRoot(import.meta.path, label);
  return initRun(repo, "integrity-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("verifyIntegrity", () => {
  beforeEach(() => {
    setupVirtualStoreFS();
  });

  afterEach(() => {
    cleanupVirtualStoreFS();
  });

  test("returns no issues for a freshly initialized, untouched run", () => {
    const runRoot = freshRun("untouched-run");
    expect(verifyIntegrity(runRoot)).toEqual([]);
  });

  test("returns a RUN_ROOT issue when the path does not exist", () => {
    const missing = join(scratchRoot(import.meta.path, "missing-path"), "does-not-exist");
    expect(verifyIntegrity(missing)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("returns a RUN_ROOT issue when the path is a file rather than a directory", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot(import.meta.path, "path-is-a-file");
    const file = join(root, "not-a-directory");
    vfs.writeFileSync(file, "x");
    expect(verifyIntegrity(file)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("returns a RUN_ROOT issue when the path is a symlink to a real directory", () => {
    const vfs = getVirtualStoreFS();
    const root = scratchRoot(import.meta.path, "path-is-a-symlink");
    const real = join(root, "real-dir");
    vfs.mkdirSync(real);
    const link = join(root, "link-dir");
    symlinkSync(real, link);
    expect(verifyIntegrity(link)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("combines manifest issues and layout issues from a tampered capsule", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("tampered-capsule");
    vfs.rmSync(join(runRoot, "manifest.json"));
    vfs.mkdirSync(join(runRoot, "blobs", "zz"), { recursive: true });
    vfs.writeFileSync(join(runRoot, "blobs", "zz", "not-a-sha"), "x");
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "MANIFEST_JSON")).toBe(true);
    expect(found.some((i) => i.code === "BLOB_NAME")).toBe(true);
  });

  test("reports EVENT_PATH when events.jsonl itself is unsafe to address", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("event-path-unsafe");
    vfs.rmSync(join(runRoot, "events.jsonl"));
    symlinkSync(
      scratchRoot(import.meta.path, "event-path-unsafe-target"),
      join(runRoot, "events.jsonl"),
    );
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "EVENT_PATH")).toBe(true);
  });

  test("reports STATE_JSON when state.json is not readable canonical JSON", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("state-json-not-canonical");
    vfs.writeFileSync(join(runRoot, "state.json"), "not json");
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "STATE_JSON")).toBe(true);
  });

  test("reports STATE_PROJECTION when state.json disagrees with the final event projection", () => {
    const vfs = getVirtualStoreFS();
    const runRoot = freshRun("state-projection-mismatch");
    vfs.writeFileSync(
      join(runRoot, "state.json"),
      canonicalJsonBytes({
        schema: "harness.state",
        version: 1,
        revision: 5,
        event_sequence: 0,
        event_head: null,
      }),
    );
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "STATE_PROJECTION")).toBe(true);
  });

  test("respects a custom maxJsonBytes limit by surfacing a MANIFEST_JSON or STATE_JSON issue", () => {
    const runRoot = freshRun("custom-max-json-bytes");
    const found = verifyIntegrity(runRoot, { maxJsonBytes: 1 });
    expect(found.length).toBeGreaterThan(0);
  });
});
