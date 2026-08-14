import { describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun } from "../../src/store/capsule.ts";
import { validateEventChain } from "../../src/store/event-stream.ts";
import { recoverProjection } from "../../src/store/recovery.ts";
import { transact } from "../../src/store/transaction.ts";
import { verifyIntegrity } from "../../src/store/integrity.ts";

const bytes = (value: string) => new TextEncoder().encode(value);
const messages = (issues: readonly { message: string }[]) =>
  issues.map((entry) => entry.message).join("\n");

function run(): string {
  const root = mkdtempSync(join(tmpdir(), "recovery-quality-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return initRun(repo, "run", bytes("prompt"), "file", true);
}

describe("operable recovery and event bounds", () => {
  test("quarantines a torn tail, truncates durably, and permits the next transaction", () => {
    const root = run();
    const expected = transact(root, "worker", "first", {}, (state) => {
      state.value = 1;
    });
    const torn = bytes('{"schema":"harness.event"');
    appendFileSync(join(root, "events.jsonl"), torn);

    const recovered = recoverProjection(root, "recovery-agent");
    expect(recovered.value).toBe(expected.value);
    expect(recovered.event_sequence).toBe(expected.event_sequence + 1);
    expect(verifyIntegrity(root)).toEqual([]);
    const quarantines = readdirSync(join(root, "evidence")).filter((name) =>
      name.startsWith("recovery-torn-"),
    );
    expect(quarantines).toHaveLength(1);
    expect(readFileSync(join(root, "evidence", quarantines[0]!))).toEqual(Buffer.from(torn));
    const repairedLog = readFileSync(join(root, "events.jsonl"), "utf8");
    expect(repairedLog.endsWith("\n")).toBeTrue();
    expect(repairedLog.trim().split("\n")).toHaveLength(2);
    expect(
      transact(root, "worker", "second", {}, (state) => {
        state.value = 2;
      }).event_sequence,
    ).toBe(3);
  });

  test("rejects immutable prompt faults before recovery and leaves state untouched", () => {
    const root = run();
    transact(root, "worker", "first", {}, (state) => {
      state.value = 1;
    });
    const statePath = join(root, "state.json");
    const before = readFileSync(statePath);
    chmodSync(join(root, "prompt.md"), 0o644);
    writeFileSync(join(root, "prompt.md"), "changed");
    expect(() => recoverProjection(root, "recovery-agent")).toThrow(/integrity/i);
    expect(readFileSync(statePath)).toEqual(before);
  });

  test("refuses a symlinked quarantine directory without changing durable data", () => {
    const root = run();
    transact(root, "worker", "first", {}, (state) => {
      state.value = 1;
    });
    appendFileSync(join(root, "events.jsonl"), bytes('{"torn"'));
    const beforeEvents = readFileSync(join(root, "events.jsonl"));
    const beforeState = readFileSync(join(root, "state.json"));
    const outside = `${root}-outside`;
    mkdirSync(outside);
    rmSync(join(root, "evidence"), { recursive: true });
    symlinkSync(outside, join(root, "evidence"));

    expect(() => recoverProjection(root, "recovery-agent")).toThrow(/unsafe|symbolic/i);
    expect(readFileSync(join(root, "events.jsonl"))).toEqual(beforeEvents);
    expect(readFileSync(join(root, "state.json"))).toEqual(beforeState);
    expect(readdirSync(outside)).toEqual([]);
  });

  test("rejects a substituted state path before appending recovery evidence", () => {
    const root = run();
    transact(root, "worker", "first", {}, (state) => {
      state.value = 1;
    });
    const statePath = join(root, "state.json");
    const outside = `${root}-outside-state.json`;
    writeFileSync(outside, "outside");
    rmSync(statePath);
    symlinkSync(outside, statePath);
    const beforeEvents = readFileSync(join(root, "events.jsonl"));

    expect(() => recoverProjection(root, "recovery-agent")).toThrow(/unsafe|symbolic/i);
    expect(readFileSync(join(root, "events.jsonl"))).toEqual(beforeEvents);
    expect(readFileSync(outside, "utf8")).toBe("outside");
  });

  test("bounds total event bytes and event count, including before append", () => {
    const root = run();
    transact(root, "worker", "first", {}, (state) => {
      state.value = 1;
    });
    transact(root, "worker", "second", {}, (state) => {
      state.value = 2;
    });
    expect(messages(verifyIntegrity(root, { maxEventCount: 1 }))).toMatch(/event count/i);
    const size = statSync(join(root, "events.jsonl")).size;
    expect(messages(verifyIntegrity(root, { maxEventLogBytes: size - 1 }))).toMatch(
      /event log.*size/i,
    );
    expect(() =>
      transact(
        root,
        "worker",
        "third",
        {},
        (state) => {
          state.value = 3;
        },
        { maxEventCount: 2 },
      ),
    ).toThrow(/event count/i);
  });

  test("can validate final projection without materializing event history", () => {
    const root = run();
    for (let index = 0; index < 3; index += 1) {
      transact(root, "worker", "record", { index }, (state) => {
        state.value = index;
      });
    }
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    const chain = validateEventChain(
      join(root, "events.jsonl"),
      { runId: "run", capsuleId: manifest.capsule_id },
      {},
      true,
      false,
    );
    expect(chain.events).toEqual([]);
    expect(chain.eventCount).toBe(3);
    expect(chain.finalState.event_sequence).toBe(3);
  });

  test("requires a nonblank recovery actor before taking the lock", () => {
    const root = run();
    transact(root, "worker", "first", {}, (state) => {
      state.value = 1;
    });
    const before = readFileSync(join(root, "events.jsonl"));
    expect(() => recoverProjection(root, "  ")).toThrow(/actor/i);
    expect(readFileSync(join(root, "events.jsonl"))).toEqual(before);
  });
});
