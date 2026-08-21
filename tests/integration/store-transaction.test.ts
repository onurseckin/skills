import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { verifyIntegrity } from "../../orchestrating-long-tasks/scripts/src/store/integrity.ts";

function init(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-transaction-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return initRun(repo, "run-001", new TextEncoder().encode("prompt"), "file", true);
}

describe("transaction normalization and rollback", () => {
  test("test_mutate_exception_does_not_append_or_advance_state", () => {
    const run = init();
    const stateBefore = readFileSync(join(run, "state.json"));
    const eventsBefore = readFileSync(join(run, "events.jsonl"));
    expect(() =>
      transact(run, "worker", "record", {}, (state) => {
        state.uncommitted = true;
        throw new Error("mutation failed");
      }),
    ).toThrow("mutation failed");
    expect(readFileSync(join(run, "state.json"))).toEqual(stateBefore);
    expect(readFileSync(join(run, "events.jsonl"))).toEqual(eventsBefore);
    expect(verifyIntegrity(run)).toEqual([]);
  });

  test("test_mutated_projection_is_normalized_to_json_types", () => {
    const run = init();
    const special = { toJSON: () => [1, 2] };
    const result = transact(run, "worker", "normalized", {}, (state) => {
      state.items = special as never;
    });
    expect(result.items).toEqual([1, 2]);
    expect(Array.isArray(result.items)).toBeTrue();
    expect(loadRun(run).state).toEqual(result);
  });

  test("rejects blank actors and kinds before taking the lock", () => {
    const run = init();
    expect(() => transact(run, "  ", "record", {}, () => undefined)).toThrow(/actor/i);
    expect(() => transact(run, "worker", "", {}, () => undefined)).toThrow(/kind/i);
  });

  test("rolls back attempts to mutate reserved projection fields", () => {
    const run = init();
    expect(() =>
      transact(run, "worker", "record", {}, (state) => {
        state.revision = 99;
      }),
    ).toThrow(/reserved/i);
    expect(loadRun(run).state.revision).toBe(0);
  });

  test("terminal completion blocks every later mutation path", () => {
    const run = init();
    transact(run, "critic", "run-completed", {}, (state) => {
      state.completion_result = { status: "complete" };
    });
    const stateBefore = readFileSync(join(run, "state.json"));
    const eventsBefore = readFileSync(join(run, "events.jsonl"));
    for (const kind of ["direct-write", "task-claimed", "plan-applied", "command-recorded"]) {
      expect(() =>
        transact(run, "late-agent", kind, {}, (state) => {
          state.late_mutation = kind;
        }),
      ).toThrow(/complete|terminal/i);
    }
    expect(readFileSync(join(run, "state.json"))).toEqual(stateBefore);
    expect(readFileSync(join(run, "events.jsonl"))).toEqual(eventsBefore);
    expect(verifyIntegrity(run)).toEqual([]);
  });
});
