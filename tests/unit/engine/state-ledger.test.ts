import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DeductiveStateMachine,
  StateLedger,
} from "../../../olt/scripts/src/engine/state-ledger.ts";

describe("StateLedger", () => {
  let testDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-state-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    ledgerPath = join(testDir, "state-ledger.json");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("readAll returns empty array when ledger file does not exist", () => {
    const ledger = new StateLedger(ledgerPath);
    const result = ledger.readAll();
    expect(result).toEqual([]);
  });

  test("appendState writes state atomically and readAll retrieves cached/persisted items", () => {
    const ledger = new StateLedger(ledgerPath);
    ledger.appendState("state-initial");
    ledger.appendState("state-active");
    ledger.appendState("state-verified");

    const states = ledger.readAll();
    expect(states).toEqual(["state-initial", "state-active", "state-verified"]);
    expect(existsSync(ledgerPath)).toBe(true);

    // Create a fresh instance reading from disk without pre-populated cache
    const reloadedLedger = new StateLedger(ledgerPath);
    const reloadedStates = reloadedLedger.readAll();
    expect(reloadedStates).toEqual(["state-initial", "state-active", "state-verified"]);
  });

  test("readAll handles corrupt JSON file gracefully by returning empty array", () => {
    writeFileSync(ledgerPath, "{ corrupted json payload ]]]", { encoding: "utf8" });
    const ledger = new StateLedger(ledgerPath);
    const states = ledger.readAll();
    expect(states).toEqual([]);
  });

  test("readAll filters out non-string items from malformed array JSON", () => {
    writeFileSync(ledgerPath, JSON.stringify(["valid-1", 123, null, { obj: true }, "valid-2"]), {
      encoding: "utf8",
    });
    const ledger = new StateLedger(ledgerPath);
    const states = ledger.readAll();
    expect(states).toEqual(["valid-1", "valid-2"]);
  });

  test("readAll handles non-array JSON content by returning empty array", () => {
    writeFileSync(ledgerPath, JSON.stringify({ key: "not an array" }), { encoding: "utf8" });
    const ledger = new StateLedger(ledgerPath);
    const states = ledger.readAll();
    expect(states).toEqual([]);
  });
});

describe("DeductiveStateMachine", () => {
  test("isPhaseVerified for 'plan' requires requirements", () => {
    const smWithoutReqs = new DeductiveStateMachine({});
    expect(smWithoutReqs.isPhaseVerified("plan")).toBe(false);

    const smWithReqs = new DeductiveStateMachine({ requirements: [{ id: "req-1" }] });
    expect(smWithReqs.isPhaseVerified("plan")).toBe(true);
  });

  test("isPhaseVerified for 'queue' and 'task' requires non-empty tasks object", () => {
    const smEmpty = new DeductiveStateMachine({});
    expect(smEmpty.isPhaseVerified("queue")).toBe(false);
    expect(smEmpty.isPhaseVerified("task")).toBe(false);

    const smEmptyTasks = new DeductiveStateMachine({ tasks: {} });
    expect(smEmptyTasks.isPhaseVerified("queue")).toBe(false);
    expect(smEmptyTasks.isPhaseVerified("task")).toBe(false);

    const smValidTasks = new DeductiveStateMachine({
      tasks: { "task-1": { id: "task-1", status: "ready" } },
    });
    expect(smValidTasks.isPhaseVerified("queue")).toBe(true);
    expect(smValidTasks.isPhaseVerified("task")).toBe(true);
  });

  test("isPhaseVerified for 'critic' checks critic reviews and completion critic status", () => {
    const smEmpty = new DeductiveStateMachine({});
    expect(smEmpty.isPhaseVerified("critic")).toBe(false);

    const smVerdict = new DeductiveStateMachine({ critic_verdict: "accepted" });
    expect(smVerdict.isPhaseVerified("critic")).toBe(true);

    const smReview = new DeductiveStateMachine({ critic_review: { approved: true } });
    expect(smReview.isPhaseVerified("critic")).toBe(true);

    const smCompletion = new DeductiveStateMachine({ completion_review: "pass" });
    expect(smCompletion.isPhaseVerified("critic")).toBe(true);

    const smReviewedCC = new DeductiveStateMachine({
      completion_critic: { status: "reviewed" },
    });
    expect(smReviewedCC.isPhaseVerified("critic")).toBe(true);

    const smUnreviewedCC = new DeductiveStateMachine({
      completion_critic: { status: "pending" },
    });
    expect(smUnreviewedCC.isPhaseVerified("critic")).toBe(false);
  });

  test("isPhaseVerified for 'run' requires completion_result", () => {
    const smWithoutResult = new DeductiveStateMachine({});
    expect(smWithoutResult.isPhaseVerified("run")).toBe(false);

    const smWithResult = new DeductiveStateMachine({ completion_result: { code: 0 } });
    expect(smWithResult.isPhaseVerified("run")).toBe(true);
  });

  test("isPhaseVerified for unknown phase defaults to true", () => {
    const sm = new DeductiveStateMachine({});
    expect(sm.isPhaseVerified("custom_unknown_phase")).toBe(true);
  });
});
