import { describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import { initRun } from "../../../olt/scripts/src/store/capsule.ts";
import { transact } from "../../../olt/scripts/src/store/transaction.ts";
import { recoverProjection } from "../../../olt/scripts/src/store/recovery.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function makeTempDir(label: string): string {
  return scratchRoot(import.meta.path, label);
}

function freshRun(label: string): string {
  const repo = makeTempDir(label);
  return initRun(repo, "recovery-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("recoverProjection", () => {
  test("rejects a blank actor", () => {
    const runRoot = freshRun("blank-actor");
    expect(() => recoverProjection(runRoot, "   ")).toThrow(/actor must be a non-blank string/);
  });

  test("rejects a run_root that is not a real directory", () => {
    const root = makeTempDir("not-a-directory");
    const file = join(root, "not-a-directory");
    writeFileSync(file, "x");
    expect(() => recoverProjection(file, "actor")).toThrow(/run_root must be a real directory/);
  });

  test("throws an integrity error when the manifest itself is broken", () => {
    const runRoot = freshRun("broken-manifest");
    rmSync(join(runRoot, "manifest.json"));
    expect(() => recoverProjection(runRoot, "actor")).toThrow(HarnessError);
  });

  test("throws when the event chain has no valid event to recover from", () => {
    const runRoot = freshRun("empty-events");
    writeFileSync(join(runRoot, "events.jsonl"), "");
    expect(() => recoverProjection(runRoot, "actor")).toThrow(
      /cannot recover state because there is no valid event/,
    );
  });

  test("throws an integrity error when the event chain contains a genuine defect", () => {
    const runRoot = freshRun("invalid-json-events");
    writeFileSync(join(runRoot, "events.jsonl"), "not valid json at all\n");
    expect(() => recoverProjection(runRoot, "actor")).toThrow(HarnessError);
  });

  test("recovers cleanly from a valid, untorn event chain by appending a recovery event", () => {
    const runRoot = freshRun("clean-recovery");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    const recovered = recoverProjection(runRoot, "recovery-actor");
    expect(recovered.event_sequence).toBe(2);
    expect(existsSync(join(runRoot, "quarantine"))).toBe(false);
  });

  test("quarantines and truncates a torn tail, then appends a recovery event referencing it", () => {
    const runRoot = freshRun("torn-tail");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    const completeBytes = statSync(join(runRoot, "events.jsonl")).size;
    appendFileSync(join(runRoot, "events.jsonl"), '{"not":"terminated"');
    const recovered = recoverProjection(runRoot, "recovery-actor");
    expect(recovered.event_sequence).toBe(2);
    const quarantineDir = join(runRoot, "quarantine");
    expect(existsSync(quarantineDir)).toBe(true);
    const fragments = readdirSync(quarantineDir).filter((name) =>
      name.startsWith("recovery-torn-"),
    );
    expect(fragments).toHaveLength(1);
    const eventsContent = readFileSync(join(runRoot, "events.jsonl"), "utf-8");
    expect(eventsContent.includes('"not":"terminated"')).toBe(false);
    expect(statSync(join(runRoot, "events.jsonl")).size).toBeGreaterThan(completeBytes);
  });

  test("creates the quarantine directory even when a prior run already left one behind", () => {
    const runRoot = freshRun("existing-quarantine");
    mkdirSync(join(runRoot, "quarantine"), { recursive: true, mode: 0o755 });
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    appendFileSync(join(runRoot, "events.jsonl"), '{"not":"terminated"');
    expect(() => recoverProjection(runRoot, "recovery-actor")).not.toThrow();
  });

  test("does not treat a missing state.json as unrecoverable, only a state.json that is not a regular file", () => {
    const runRoot = freshRun("missing-state-json");
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    rmSync(join(runRoot, "state.json"));
    expect(() => recoverProjection(runRoot, "actor")).not.toThrow();
  });

  test("throws when state.json exists but is not a regular file", () => {
    const runRoot = freshRun("state-json-not-regular-file");
    rmSync(join(runRoot, "state.json"));
    mkdirSync(join(runRoot, "state.json"));
    expect(() => recoverProjection(runRoot, "actor")).toThrow(/state\.json is not a regular file/);
  });
});
