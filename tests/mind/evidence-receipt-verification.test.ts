import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonBytes, sha256Bytes } from "../../olt/scripts/src/core/json.ts";
import type { JsonObject } from "../../olt/scripts/src/core/contracts/index.ts";
import {
  inspectCommandReceipts,
  inspectMilestoneEvents,
  verifyEventsHashChain,
  verifyMilestoneEvidence,
} from "../../olt/scripts/src/mind/evidence/index.ts";
import { evaluateSupervisoryState } from "../../olt/scripts/src/authority/supervisory/index.ts";

describe("Evidence Receipt Verification Engine", () => {
  const testDir = join(process.cwd(), "scratch", "test-evidence-receipts-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createTestEvent(params: {
    sequence: number;
    kind: string;
    actor: string;
    previousHash: string | null;
    payload: Record<string, unknown>;
  }): Record<string, unknown> {
    const rawContent: Record<string, unknown> = {
      schema: "https://skills.olt/schemas/event.json",
      version: 1,
      run_id: "run-test",
      capsule_id: "capsule-test",
      sequence: params.sequence,
      revision: params.sequence,
      previous_hash: params.previousHash,
      actor: params.actor,
      kind: params.kind,
      payload: params.payload,
      timestamp: "2026-08-29T20:00:00.000Z",
    };
    const hash = sha256Bytes(canonicalJsonBytes(rawContent as JsonObject));
    return { ...rawContent, hash };
  }

  it("validates an intact SHA-256 hash-chain sequence from sequence 1 to tail", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-initialized",
      actor: "owner",
      previousHash: null,
      payload: { generation: 1 },
    });
    const event2 = createTestEvent({
      sequence: 2,
      kind: "command-executed",
      actor: "mind-1",
      previousHash: event1["hash"] as string,
      payload: { command: "harness:doctor", exit_code: 0, stdout_hash: "abcd" },
    });

    writeFileSync(eventsPath, JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n");

    const result = verifyEventsHashChain(eventsPath);
    expect(result.verification.valid).toBe(true);
    expect(result.verification.totalEvents).toBe(2);
    expect(result.verification.headHash).toBe(event2["hash"] as string);
    expect(result.events.length).toBe(2);
  });

  it("fails verification when hash does not match computed SHA-256 canonical bytes", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-initialized",
      actor: "owner",
      previousHash: null,
      payload: { generation: 1 },
    });
    const tampered = {
      ...event1,
      hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    writeFileSync(eventsPath, JSON.stringify(tampered) + "\n");

    const result = verifyEventsHashChain(eventsPath);
    expect(result.verification.valid).toBe(false);
    expect(result.verification.brokenAtSequence).toBe(1);
    expect(result.verification.error).toContain("hash mismatch");
  });

  it("fails verification when previous_hash link is broken in sequence", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-initialized",
      actor: "owner",
      previousHash: null,
      payload: { generation: 1 },
    });
    const event2 = createTestEvent({
      sequence: 2,
      kind: "command-executed",
      actor: "mind-1",
      previousHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      payload: { command: "harness:doctor", exit_code: 0 },
    });

    writeFileSync(eventsPath, JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n");

    const result = verifyEventsHashChain(eventsPath);
    expect(result.verification.valid).toBe(false);
    expect(result.verification.brokenAtSequence).toBe(2);
    expect(result.verification.error).toContain("does not match expected");
  });

  it("fails verification when sequence numbers skip an index", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-initialized",
      actor: "owner",
      previousHash: null,
      payload: { generation: 1 },
    });
    const event3 = createTestEvent({
      sequence: 3,
      kind: "command-executed",
      actor: "mind-1",
      previousHash: event1["hash"] as string,
      payload: { command: "harness:doctor", exit_code: 0 },
    });

    writeFileSync(eventsPath, JSON.stringify(event1) + "\n" + JSON.stringify(event3) + "\n");

    const result = verifyEventsHashChain(eventsPath);
    expect(result.verification.valid).toBe(false);
    expect(result.verification.brokenAtSequence).toBe(2);
    expect(result.verification.error).toContain("does not match expected sequence");
  });

  it("inspects command receipts from both events and state objects", () => {
    const events = [
      {
        kind: "command-executed",
        payload: {
          task_id: "task-1",
          actor: "worker-1",
          command: "bun test",
          argv: ["bun", "test"],
          exit_code: 0,
          stdout_hash: "hash1",
        },
      },
    ];
    const stateObj = {
      receipts: {
        "task-2:100": {
          task_id: "task-2",
          actor: "worker-2",
          command: "git status",
          exit_code: 0,
        },
      },
    };

    const receipts = inspectCommandReceipts(events, stateObj);
    expect(receipts.length).toBe(2);
    expect(receipts[0]?.command).toBe("bun test");
    expect(receipts[0]?.valid).toBe(true);
    expect(receipts[1]?.command).toBe("git status");
    expect(receipts[1]?.valid).toBe(true);

    const kinds = inspectMilestoneEvents(events);
    expect(kinds.has("command-executed")).toBe(true);
  });

  it("certifies milestone ignition when hash chain is valid, mind-initialized exists, and command receipt passes", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const statePath = join(testDir, "state.json");

    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-initialized",
      actor: "owner",
      previousHash: null,
      payload: { generation: 1 },
    });
    const event2 = createTestEvent({
      sequence: 2,
      kind: "command-executed",
      actor: "mind-1",
      previousHash: event1["hash"] as string,
      payload: { command: "mind:wake", exit_code: 0 },
    });

    writeFileSync(eventsPath, JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n");
    writeFileSync(statePath, JSON.stringify({ receipts: {} }));

    const verification = verifyMilestoneEvidence(testDir, "ignition");
    expect(verification.certified).toBe(true);
    expect(verification.hashChain.valid).toBe(true);
    expect(verification.commandReceipts.length).toBe(1);
    expect(verification.failedReceipts.length).toBe(0);
    expect(verification.errors.length).toBe(0);
  });

  it("fails milestone ignition when sequence is stuck at 1 with 0 command receipts", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const statePath = join(testDir, "state.json");

    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-initialized",
      actor: "owner",
      previousHash: null,
      payload: { generation: 1 },
    });

    writeFileSync(eventsPath, JSON.stringify(event1) + "\n");
    writeFileSync(statePath, JSON.stringify({ receipts: {} }));

    const verification = verifyMilestoneEvidence(testDir, "ignition");
    expect(verification.certified).toBe(false);
    expect(verification.errors.some((e) => e.includes("stuck at 1 with 0 command receipts"))).toBe(
      true,
    );
  });

  it("fails milestone certification when required receipts have non-zero exit codes", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const statePath = join(testDir, "state.json");

    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-initialized",
      actor: "owner",
      previousHash: null,
      payload: { generation: 1 },
    });
    const event2 = createTestEvent({
      sequence: 2,
      kind: "command-executed",
      actor: "mind-1",
      previousHash: event1["hash"] as string,
      payload: { command: "mind:wake", exit_code: 1 },
    });

    writeFileSync(eventsPath, JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n");
    writeFileSync(statePath, JSON.stringify({ receipts: {} }));

    const verification = verifyMilestoneEvidence(testDir, "ignition");
    expect(verification.certified).toBe(false);
    expect(verification.failedReceipts.length).toBe(1);
    expect(verification.errors.some((e) => e.includes("non-zero exit code"))).toBe(true);
  });

  it("triggers PROSE_EVIDENCE_BIAS_BREACH supervisory violation on failed evidence verification", () => {
    const evalResult = evaluateSupervisoryState({
      role: "coordinator",
      evidenceVerificationFailed: true,
    });

    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find((v) => v.code === "PROSE_EVIDENCE_BIAS_BREACH");
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("critical");
  });

  it("verifies pulse milestone evidence and formats brief correctly", () => {
    const eventsPath = join(testDir, "events.jsonl");
    const event1 = createTestEvent({
      sequence: 1,
      kind: "mind-pulse-opened",
      actor: "mind-1",
      previousHash: null,
      payload: { pulse_id: "pulse-1" },
    });
    writeFileSync(eventsPath, JSON.stringify(event1) + "\n");

    const verification = verifyMilestoneEvidence(testDir, "pulse");
    expect(verification.certified).toBe(true);
    expect(verification.milestone).toBe("pulse");
  });
});
