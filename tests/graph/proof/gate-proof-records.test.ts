import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  appendGateProof,
  latestGateProof,
  readGateProofs,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import { record } from "./gate-proof-fixture.ts";

describe("gate proof records", () => {
  test("appendGateProof is additive and readGateProofs replays it back in order", () => {
    const state: JsonObject = {};
    appendGateProof(state, record({ exit_code: 1 }));
    appendGateProof(state, record({ exit_code: 2, falsifiable: false }));
    const records = readGateProofs(state);
    expect(records.map((entry) => entry.exit_code)).toEqual([1, 2]);
  });

  test("latestGateProof returns the most recent record for the task's current gate argv", () => {
    const state: JsonObject = {};
    appendGateProof(state, record({ gate_argv: ["old", "gate"], falsifiable: true }));
    appendGateProof(
      state,
      record({ gate_argv: ["bun", "test", "tests/db.test.ts"], falsifiable: false }),
    );
    appendGateProof(
      state,
      record({ gate_argv: ["bun", "test", "tests/db.test.ts"], falsifiable: true }),
    );
    const found = latestGateProof(state, "task-1", ["bun", "test", "tests/db.test.ts"]);
    expect(found?.falsifiable).toBe(true);
  });

  test("latestGateProof is undefined when the exact gate has never been proved", () => {
    const state: JsonObject = {};
    appendGateProof(state, record({ gate_argv: ["old", "gate"] }));
    expect(latestGateProof(state, "task-1", ["bun", "test", "tests/db.test.ts"])).toBeUndefined();
  });

  test("readGateProofs never throws on a tree gate:prove has never touched", () => {
    expect(readGateProofs({})).toEqual([]);
  });
});
