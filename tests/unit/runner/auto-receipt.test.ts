import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { AutoReceiptLogger } from "../../../olt/scripts/src/engine/runner/auto-receipt.ts";
import { rmSync, mkdirSync, readFileSync } from "node:fs";

describe("AutoReceiptLogger", () => {
  const capsuleRoot = "./test-capsule-root";

  beforeEach(() => {
    mkdirSync(capsuleRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(capsuleRoot, { recursive: true, force: true });
  });

  it("records command receipt directly into capsule state", () => {
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
});
