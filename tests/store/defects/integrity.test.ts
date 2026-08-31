import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity/integrity.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

function freshRun(label: string): string {
  const repo = scratchRoot(import.meta.path, label);
  return initRun(repo, "integrity-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("verifyIntegrity", () => {
  test("returns no issues for a freshly initialized, untouched run", () => {
    const runRoot = freshRun("untouched-run");
    expect(verifyIntegrity(runRoot)).toEqual([]);
  });

  test("returns a RUN_ROOT issue when the path does not exist", () => {
    const missing = join(scratchRoot(import.meta.path, "missing-path"), "does-not-exist");
    expect(verifyIntegrity(missing)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("returns a RUN_ROOT issue when the path is a file rather than a directory", () => {
    const root = scratchRoot(import.meta.path, "path-is-a-file");
    const file = join(root, "not-a-directory");
    writeFileSync(file, "x");
    expect(verifyIntegrity(file)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("returns a RUN_ROOT issue when the path is a symlink to a real directory", () => {
    const root = scratchRoot(import.meta.path, "path-is-a-symlink");
    const real = join(root, "real-dir");
    mkdirSync(real);
    const link = join(root, "link-dir");
    symlinkSync(real, link);
    expect(verifyIntegrity(link)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("combines manifest issues and layout issues from a tampered capsule", () => {
    const runRoot = freshRun("tampered-capsule");
    rmSync(join(runRoot, "manifest.json"));
    mkdirSync(join(runRoot, "blobs", "zz"), { recursive: true });
    writeFileSync(join(runRoot, "blobs", "zz", "not-a-sha"), "x");
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "MANIFEST_JSON")).toBe(true);
    expect(found.some((i) => i.code === "BLOB_NAME")).toBe(true);
  });

  test("reports EVENT_PATH when events.jsonl itself is unsafe to address", () => {
    const runRoot = freshRun("event-path-unsafe");
    rmSync(join(runRoot, "events.jsonl"));
    symlinkSync(
      scratchRoot(import.meta.path, "event-path-unsafe-target"),
      join(runRoot, "events.jsonl"),
    );
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "EVENT_PATH")).toBe(true);
  });

  test("reports STATE_JSON when state.json is not readable canonical JSON", () => {
    const runRoot = freshRun("state-json-not-canonical");
    writeFileSync(join(runRoot, "state.json"), "not json");
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "STATE_JSON")).toBe(true);
  });

  test("reports STATE_PROJECTION when state.json disagrees with the final event projection", () => {
    const runRoot = freshRun("state-projection-mismatch");
    writeFileSync(
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
