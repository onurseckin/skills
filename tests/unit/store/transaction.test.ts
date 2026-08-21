import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RunState,
  StateMutator,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-transaction-"));
  roots.push(root);
  return root;
}

function freshRun(): string {
  const repo = scratchRoot();
  return initRun(repo, "transaction-run", new TextEncoder().encode("prompt"), "file", true);
}

const noop: StateMutator = () => {};

describe("transact", () => {
  test("rejects a blank actor or kind before touching the run", () => {
    const runRoot = freshRun();
    expect(() => transact(runRoot, "  ", "kind", {}, noop)).toThrow(/actor must be a non-blank/);
    expect(() => transact(runRoot, "actor", "  ", {}, noop)).toThrow(/kind must be a non-blank/);
  });

  test("rejects a non-object, array, or null payload", () => {
    const runRoot = freshRun();
    expect(() => transact(runRoot, "actor", "kind", null as never, noop)).toThrow(
      /payload must be an object/,
    );
    expect(() => transact(runRoot, "actor", "kind", [] as never, noop)).toThrow(
      /payload must be an object/,
    );
  });

  test("rejects a non-callable mutate function", () => {
    const runRoot = freshRun();
    expect(() => transact(runRoot, "actor", "kind", {}, "not-a-function" as never)).toThrow(
      /mutate must be callable/,
    );
  });

  test("applies a mutation and returns the resulting projected state with an advanced revision", () => {
    const runRoot = freshRun();
    const result = transact(runRoot, "tester", "task-created", { task_id: "T-1" }, (draft) => {
      (draft as RunState & { tasks: Record<string, unknown> }).tasks = {
        "T-1": { status: "open" },
      };
    });
    expect(result.revision).toBe(1);
    expect(result.event_sequence).toBe(1);
    expect((result as unknown as { tasks: Record<string, unknown> }).tasks).toEqual({
      "T-1": { status: "open" },
    });
  });

  test("rejects mutating a reserved state field, such as schema or revision, directly", () => {
    const runRoot = freshRun();
    expect(() =>
      transact(runRoot, "tester", "kind", {}, (draft) => {
        (draft as unknown as { schema: string }).schema = "tampered";
      }),
    ).toThrow(/cannot change reserved state field: schema/);
  });

  test("rejects mutating a run that has already completed", () => {
    const runRoot = freshRun();
    transact(runRoot, "tester", "complete", {}, (draft) => {
      (draft as unknown as { completion_result: { status: string } }).completion_result = {
        status: "complete",
      };
    });
    expect(() => transact(runRoot, "tester", "another", {}, noop)).toThrow(HarnessError);
    expect(() => transact(runRoot, "tester", "another", {}, noop)).toThrow(
      /completed runs are terminal/,
    );
  });

  test("does not treat a non-object completion_result as terminal", () => {
    const runRoot = freshRun();
    transact(runRoot, "tester", "kind", {}, (draft) => {
      (draft as unknown as { completion_result: string }).completion_result = "not-an-object";
    });
    expect(() => transact(runRoot, "tester", "kind-2", {}, noop)).not.toThrow();
  });

  test("does not treat a completion_result with a non-complete status as terminal", () => {
    const runRoot = freshRun();
    transact(runRoot, "tester", "kind", {}, (draft) => {
      (draft as unknown as { completion_result: { status: string } }).completion_result = {
        status: "in_progress",
      };
    });
    expect(() => transact(runRoot, "tester", "kind-2", {}, noop)).not.toThrow();
  });

  test("normalizes the payload through canonical JSON before recording it", () => {
    const runRoot = freshRun();
    transact(runRoot, "tester", "kind", { b: 2, a: 1 }, noop);
  });
});
