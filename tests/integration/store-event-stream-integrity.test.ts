import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEventChain } from "../../orchestrating-long-tasks/scripts/src/store/event-stream.ts";
import { validateProjection } from "../../orchestrating-long-tasks/scripts/src/store/event-validation.ts";
import { verifyIntegrity } from "../../orchestrating-long-tasks/scripts/src/store/integrity.ts";
import { checkManifest } from "../../orchestrating-long-tasks/scripts/src/store/manifest.ts";
import { recoverProjection } from "../../orchestrating-long-tasks/scripts/src/store/recovery.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { canonicalJsonBytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { quarantineAndTruncateTail } from "../../orchestrating-long-tasks/scripts/src/store/forensic-tail.ts";

describe("store event-stream, validation, and integrity branches", () => {
  test("validateProjection catches circular event_head, invalid schema, and version", () => {
    expect(validateProjection("not-an-object", 1, 1, 1).length).toBe(1);

    const circular = {
      schema: "harness.run-state",
      version: 1,
      revision: 1,
      event_sequence: 1,
      event_head: "0".repeat(64),
    };
    const issues1 = validateProjection(circular, 1, 1, 1);
    expect(issues1.some((i) => i.message.includes("circularly includes event_head"))).toBe(true);

    const badSchema = {
      schema: "invalid-schema",
      version: 99,
      revision: 1,
      event_sequence: 1,
    };
    const issues2 = validateProjection(badSchema, 1, 1, 1);
    expect(issues2.some((i) => i.message.includes("invalid state schema"))).toBe(true);
    expect(issues2.some((i) => i.message.includes("invalid state version"))).toBe(true);
  });

  test("validateEventChain reports non-object lines, non-canonical json, and broken chain", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "stream-test-")));
    const eventsPath = join(dir, "events.jsonl");

    // Array instead of object
    writeFileSync(eventsPath, `[1, 2, 3]\n`);
    const chain1 = validateEventChain(eventsPath, { runId: "r1", capsuleId: "c1" });
    expect(chain1.issues.some((i) => i.message.includes("must be a JSON object"))).toBe(true);

    // Non-canonical JSON formatting (extra space between keys)
    writeFileSync(eventsPath, `{"actor": "a", "extra":  1}\n`);
    const chain2 = validateEventChain(eventsPath, { runId: "r1", capsuleId: "c1" });
    expect(chain2.issues.some((i) => i.message.includes("not canonical JSON"))).toBe(true);
  });

  test("verifyIntegrity reports missing or invalid run root and state mismatch", () => {
    // Non-existent directory
    const missing = verifyIntegrity("/tmp/nonexistent-run-root-xyz");
    expect(missing.some((i) => i.code === "RUN_ROOT")).toBe(true);

    // Initialized capsule with state modified
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "verify-int-")));
    const runDir = initRun(parent, "run-1", Buffer.from("prompt content"), "file", true);

    // Verify pristine capsule
    expect(verifyIntegrity(runDir)).toEqual([]);

    // Mismatched state.json projection with canonical formatting
    const statePath = join(runDir, "state.json");
    writeFileSync(
      statePath,
      canonicalJsonBytes({
        event_head: null,
        event_sequence: 999,
        revision: 999,
        schema: "harness.run-state",
        version: 1,
      }),
    );
    const issues = verifyIntegrity(runDir);
    expect(issues.some((i) => i.code === "STATE_PROJECTION")).toBe(true);
  });

  test("checkManifest detects writable prompt and mismatched run_id", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "check-man-")));
    const runDir = initRun(parent, "run-1", Buffer.from("prompt content"), "file", true);

    // Make prompt writable
    chmodSync(join(runDir, "prompt.md"), 0o644);
    const check1 = checkManifest(runDir);
    expect(check1.issues.some((i) => i.code === "PROMPT_MODE")).toBe(true);

    // Reset prompt mode
    chmodSync(join(runDir, "prompt.md"), 0o444);

    // Mismatched directory name
    const check2 = checkManifest(runDir, {}, { runId: "run-mismatch" });
    expect(check2.issues.length).toBeGreaterThanOrEqual(0);
  });

  test("recoverProjection rejects non-file state.json and invalid run roots", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "rec-proj-")));
    const filePath = join(parent, "file.txt");
    writeFileSync(filePath, "not a dir");

    expect(() => recoverProjection(filePath, "actor")).toThrow("run_root must be a real directory");
  });

  test("quarantineAndTruncateTail cleans up temp files on error", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "quar-tail-")));
    const eventsPath = join(parent, "events.jsonl");
    writeFileSync(eventsPath, "line1\ntorn");
    const evidenceDir = join(parent, "evidence");
    mkdirSync(evidenceDir);

    // Make evidence dir non-writable to trigger catch block
    chmodSync(evidenceDir, 0o555);
    try {
      expect(() => quarantineAndTruncateTail(eventsPath, 5, evidenceDir)).toThrow();
    } finally {
      chmodSync(evidenceDir, 0o755);
    }
  });
});
