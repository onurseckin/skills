import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { recoverProjection } from "../../../orchestrating-long-tasks/scripts/src/store/recovery.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-recovery-"));
  roots.push(root);
  return root;
}

function freshRun(): string {
  const repo = scratchRoot();
  return initRun(repo, "recovery-run", new TextEncoder().encode("prompt"), "file", true);
}

describe("recoverProjection", () => {
  test("rejects a blank actor", () => {
    const runRoot = freshRun();
    expect(() => recoverProjection(runRoot, "   ")).toThrow(/actor must be a non-blank string/);
  });

  test("rejects a run_root that is not a real directory", () => {
    const root = scratchRoot();
    const file = join(root, "not-a-directory");
    writeFileSync(file, "x");
    expect(() => recoverProjection(file, "actor")).toThrow(/run_root must be a real directory/);
  });

  test("throws an integrity error when the manifest itself is broken", () => {
    const runRoot = freshRun();
    rmSync(join(runRoot, "manifest.json"));
    expect(() => recoverProjection(runRoot, "actor")).toThrow(HarnessError);
  });

  test("throws when the event chain has no valid event to recover from", () => {
    const runRoot = freshRun();
    writeFileSync(join(runRoot, "events.jsonl"), "");
    expect(() => recoverProjection(runRoot, "actor")).toThrow(
      /cannot recover state because there is no valid event/,
    );
  });

  test("throws an integrity error when the event chain contains a genuine defect", () => {
    const runRoot = freshRun();
    writeFileSync(join(runRoot, "events.jsonl"), "not valid json at all\n");
    expect(() => recoverProjection(runRoot, "actor")).toThrow(HarnessError);
  });

  test("recovers cleanly from a valid, untorn event chain by appending a recovery event", () => {
    const runRoot = freshRun();
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    const recovered = recoverProjection(runRoot, "recovery-actor");
    expect(recovered.event_sequence).toBe(2);
    expect(existsSync(join(runRoot, "quarantine"))).toBe(false);
  });

  test("quarantines and truncates a torn tail, then appends a recovery event referencing it", () => {
    const runRoot = freshRun();
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
    const runRoot = freshRun();
    mkdirSync(join(runRoot, "quarantine"), { recursive: true, mode: 0o755 });
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    appendFileSync(join(runRoot, "events.jsonl"), '{"not":"terminated"');
    expect(() => recoverProjection(runRoot, "recovery-actor")).not.toThrow();
  });

  test("does not treat a missing state.json as unrecoverable, only a state.json that is not a regular file", () => {
    const runRoot = freshRun();
    transact(runRoot, "tester", "task-created", {}, (draft) => {
      (draft as unknown as { tasks: Record<string, unknown> }).tasks = { "T-1": {} };
    });
    rmSync(join(runRoot, "state.json"));
    expect(() => recoverProjection(runRoot, "actor")).not.toThrow();
  });

  test("throws when state.json exists but is not a regular file", () => {
    const runRoot = freshRun();
    rmSync(join(runRoot, "state.json"));
    mkdirSync(join(runRoot, "state.json"));
    expect(() => recoverProjection(runRoot, "actor")).toThrow(/state\.json is not a regular file/);
  });
});
