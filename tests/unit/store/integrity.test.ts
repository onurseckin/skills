import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { verifyIntegrity } from "../../../orchestrating-long-tasks/scripts/src/store/integrity.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-integrity-"));
  roots.push(root);
  return root;
}

function freshRun(): string {
  const repo = scratchRoot();
  return initRun(repo, "integrity-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("verifyIntegrity", () => {
  test("returns no issues for a freshly initialized, untouched run", () => {
    const runRoot = freshRun();
    expect(verifyIntegrity(runRoot)).toEqual([]);
  });

  test("returns a RUN_ROOT issue when the path does not exist", () => {
    const missing = join(tmpdir(), `store-integrity-missing-${Date.now()}`);
    expect(verifyIntegrity(missing)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("returns a RUN_ROOT issue when the path is a file rather than a directory", () => {
    const root = scratchRoot();
    const file = join(root, "not-a-directory");
    writeFileSync(file, "x");
    expect(verifyIntegrity(file)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("returns a RUN_ROOT issue when the path is a symlink to a real directory", () => {
    const root = scratchRoot();
    const real = join(root, "real-dir");
    mkdirSync(real);
    const link = join(root, "link-dir");
    symlinkSync(real, link);
    expect(verifyIntegrity(link)).toEqual([expect.objectContaining({ code: "RUN_ROOT" })]);
  });

  test("combines manifest issues and layout issues from a tampered capsule", () => {
    const runRoot = freshRun();
    rmSync(join(runRoot, "manifest.json"));
    mkdirSync(join(runRoot, "blobs", "zz"), { recursive: true });
    writeFileSync(join(runRoot, "blobs", "zz", "not-a-sha"), "x");
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "MANIFEST_JSON")).toBe(true);
    expect(found.some((i) => i.code === "BLOB_NAME")).toBe(true);
  });

  test("reports EVENT_PATH when events.jsonl itself is unsafe to address", () => {
    const runRoot = freshRun();
    rmSync(join(runRoot, "events.jsonl"));
    symlinkSync(join(tmpdir()), join(runRoot, "events.jsonl"));
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "EVENT_PATH")).toBe(true);
  });

  test("reports STATE_JSON when state.json is not readable canonical JSON", () => {
    const runRoot = freshRun();
    writeFileSync(join(runRoot, "state.json"), "not json");
    const found = verifyIntegrity(runRoot);
    expect(found.some((i) => i.code === "STATE_JSON")).toBe(true);
  });

  test("reports STATE_PROJECTION when state.json disagrees with the final event projection", () => {
    const runRoot = freshRun();
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
    const runRoot = freshRun();
    const found = verifyIntegrity(runRoot, { maxJsonBytes: 1 });
    expect(found.length).toBeGreaterThan(0);
  });
});
