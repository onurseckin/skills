import { describe, expect, it } from "bun:test";
import {
  inspectCommandReceipts,
  inspectMilestoneEvents,
} from "../../../../olt/scripts/src/mind/evidence/receipt-inspector.ts";

describe("Receipt Inspector Coverage Suite", () => {
  it("extracts command receipts from various event types with payload and top-level fields", () => {
    const events: Record<string, unknown>[] = [
      // 1. command-executed with payload
      {
        kind: "command-executed",
        timestamp: "2026-09-01T10:00:00.000Z",
        payload: {
          command: "bun test",
          actor: "executor-1",
          exit_code: 0,
          task_id: "task-101",
          argv: ["bun", "test", "--coverage", 123],
          stdout_hash: "hash-out-1",
        },
      },
      // 2. run-exec with top-level fields (non-zero exit code)
      {
        type: "run-exec",
        command: "tsc --noEmit",
        actor: "typechecker",
        exit_code: 1,
        task_id: "task-102",
        argv: ["tsc", "--noEmit"],
        stdout_hash: "hash-out-2",
        timestamp: "2026-09-01T10:05:00.000Z",
      },
      // 3. task-executed with payload timestamp fallback and missing actor
      {
        kind: "task-executed",
        payload: {
          command: "oxfmt --check",
          exit_code: 0,
          timestamp: "2026-09-01T10:10:00.000Z",
        },
      },
      // 4. event with no command field (should be skipped)
      {
        kind: "command-executed",
        payload: { actor: "someone", exit_code: 0 },
      },
      // 5. ignored event kind
      {
        kind: "pulse-heartbeat",
        command: "ping",
      },
    ];

    const receipts = inspectCommandReceipts(events);
    expect(receipts.length).toBe(3);

    expect(receipts[0]).toEqual({
      taskId: "task-101",
      actor: "executor-1",
      command: "bun test",
      argv: ["bun", "test", "--coverage"],
      exitCode: 0,
      stdoutHash: "hash-out-1",
      timestamp: "2026-09-01T10:00:00.000Z",
      valid: true,
      source: "event",
    });

    expect(receipts[1]).toEqual({
      taskId: "task-102",
      actor: "typechecker",
      command: "tsc --noEmit",
      argv: ["tsc", "--noEmit"],
      exitCode: 1,
      stdoutHash: "hash-out-2",
      timestamp: "2026-09-01T10:05:00.000Z",
      valid: false,
      source: "event",
    });

    expect(receipts[2]?.actor).toBe("unknown");
    expect(receipts[2]?.valid).toBe(true);
    expect(receipts[2]?.timestamp).toBe("2026-09-01T10:10:00.000Z");
  });

  it("extracts stateObj receipts and commands maps while handling invalid items", () => {
    const stateObj: Record<string, unknown> = {
      receipts: {
        rec1: {
          command: "git status",
          actor: "git-bot",
          exit_code: 0,
          timestamp: "2026-09-01T12:00:00.000Z",
        },
        recInvalid: "not-an-object",
        recNoCmd: { actor: "git-bot" },
      },
      commands: {
        cmd1: {
          command: "git diff",
          actor: "git-bot",
          exit_code: 0,
        },
        cmdInvalidPrimitive: 42,
      },
    };

    const receipts = inspectCommandReceipts([], stateObj);
    expect(receipts.length).toBe(2);
    expect(receipts[0]?.command).toBe("git status");
    expect(receipts[0]?.source).toBe("state");
    expect(receipts[1]?.command).toBe("git diff");
    expect(receipts[1]?.source).toBe("state");

    // Handling invalid non-object state collections gracefully
    const corruptState: Record<string, unknown> = {
      receipts: ["not-a-map"],
      commands: "not-a-map",
    };
    const emptyReceipts = inspectCommandReceipts([], corruptState);
    expect(emptyReceipts.length).toBe(0);
  });

  it("collects milestone event kinds with kind and type aliases", () => {
    const events: Record<string, unknown>[] = [
      { kind: "milestone-completed" },
      { type: "milestone-started" },
      { kind: "milestone-completed" }, // duplicate
      { kind: "" }, // empty ignored
      { noKindOrType: true }, // missing
      { kind: 123 }, // non-string ignored
    ];

    const kinds = inspectMilestoneEvents(events);
    expect(kinds.size).toBe(2);
    expect(kinds.has("milestone-completed")).toBe(true);
    expect(kinds.has("milestone-started")).toBe(true);
    expect(kinds.has("")).toBe(false);
  });
});
