import { describe, it, expect } from "bun:test";
import { AutoReceiptLogger } from "../../../olt/scripts/src/engine/runner/auto-receipt.ts";
import { initRun, loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { readFileSync } from "node:fs";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("AutoReceiptLogger", () => {
  it("can be instantiated", () => {
    const logger = new AutoReceiptLogger();
    expect(logger).toBeInstanceOf(AutoReceiptLogger);
    expect(logger.constructor).toBe(AutoReceiptLogger);
    const viaReflect = Reflect.construct(AutoReceiptLogger, []);
    expect(viaReflect).toBeInstanceOf(AutoReceiptLogger);
    class SubLogger extends AutoReceiptLogger {
      constructor() {
        super();
      }
    }
    const sub = new SubLogger();
    expect(sub).toBeInstanceOf(AutoReceiptLogger);
  });

  it("records command receipt directly into capsule state", () => {
    const capsuleRoot = scratchRoot(import.meta.path, "auto-receipt-record");
    AutoReceiptLogger.recordReceipt(capsuleRoot, {
      taskId: "task-1",
      actor: "impl-1",
      command: "echo",
      argv: ["hello"],
      exitCode: 0,
      stdout: "hello\n",
    });

    const events = readFileSync(`${capsuleRoot}/events.jsonl`, "utf8").trim().split("\n");
    expect(events.length).toBe(1);

    const event = JSON.parse(events[0]);
    expect(event.type).toBe("command-executed");
    expect(event.task_id).toBe("task-1");
    expect(event.actor).toBe("impl-1");
    expect(event.command).toBe("echo");
    expect(event.argv).toEqual(["hello"]);
    expect(event.exit_code).toBe(0);
    expect(event.stdout_hash).toBe(
      "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
    ); // sha256 of "hello\n"
  });

  it("records command receipt via state transaction when capsule ledger is active", () => {
    const testRepo = scratchRoot(import.meta.path, "auto-receipt-transact-repo");
    const runRoot = initRun(
      testRepo,
      "test-capsule",
      new TextEncoder().encode("test prompt"),
      "file",
      true,
    );

    AutoReceiptLogger.recordReceipt(runRoot, {
      taskId: "task-check-1",
      actor: "mechanic-validator",
      command: "task:check",
      argv: ["task:check", "--file", "src/foo.ts"],
      exitCode: 0,
      stdout: "All invariants satisfied\n",
      updateState: true,
    });

    const loaded = loadRun(runRoot);
    const stateReceipts = (loaded.state.receipts ?? {}) as Record<string, Record<string, unknown>>;
    const receiptKeys = Object.keys(stateReceipts);
    expect(receiptKeys.length).toBe(1);
    const receiptEntry = stateReceipts[receiptKeys[0] as string];
    expect(receiptEntry).toBeDefined();
    expect(receiptEntry?.task_id).toBe("task-check-1");
    expect(receiptEntry?.actor).toBe("mechanic-validator");
    expect(receiptEntry?.command).toBe("task:check");
    expect(receiptEntry?.exit_code).toBe(0);

    const events = readFileSync(`${runRoot}/events.jsonl`, "utf8").trim().split("\n");
    expect(events.length).toBeGreaterThanOrEqual(1);
    const lastEvent = JSON.parse(events[events.length - 1] as string);
    expect(lastEvent.kind).toBe("command-executed");
    expect(lastEvent.actor).toBe("mechanic-validator");
  });
});
