import { describe, expect, test } from "bun:test";
import { readAgentLedgerView } from "../../../olt/scripts/src/summary/agent-telemetry.ts";
import { AssetRegistry } from "../../../olt/scripts/src/summary/graph-asset-ownership.ts";
import { buildGateNode } from "../../../olt/scripts/src/summary/graph-generator-gate-helpers.ts";
import { mapGateStatus } from "../../../olt/scripts/src/summary/graph-node-context.ts";
import { prepareTaskContext } from "../../../olt/scripts/src/summary/graph-task-preparation.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { makeTask } from "./graph-fixtures.ts";

function contextFor(task: TaskRecord) {
  return prepareTaskContext({
    task,
    taskStep: 2,
    taskWave: 1,
    commands: [],
    ledger: readAgentLedgerView({}),
    registry: new AssetRegistry(),
  });
}

describe("gate node", () => {
  test("maps gate status across the task lifecycle", () => {
    const statuses: Array<[TaskRecord["status"], string]> = [
      ["done", "success"],
      ["validated", "success"],
      ["changes_requested", "warning"],
      ["cancelled", "error"],
      ["escalated", "error"],
      ["validating", "running"],
      ["gating", "running"],
      ["proposed", "pending"],
      ["ready", "pending"],
    ];
    for (const [status, expected] of statuses) {
      expect(mapGateStatus(makeTask("T", { status }))).toBe(expected);
    }
    expect(
      mapGateStatus(
        makeTask("T", {
          status: "leased",
          validations: [
            {
              validator_id: "val-1",
              domain: "code-quality",
              token_digest: "tok",
              attempt: 1,
              started_at: "2026-08-14T20:00:00.000Z",
              deadline_at: "2026-08-14T20:10:00.000Z",
            },
          ],
        }),
      ),
    ).toBe("running");
  });

  test("records gate results and references findings instead of copying them", () => {
    const task = makeTask("T-pushback", {
      status: "changes_requested",
      repair_round: 2,
      write_scope: ["src/feature.ts"],
      gate_results: [{ gate_id: "gate-1", command_id: "C-9", status: "passed" }],
      validations: [
        {
          validator_id: "validator-alpha",
          domain: "code-quality",
          token_digest: "tok1",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "F-101",
          requirement_id: "REQ-T-pushback",
          severity: "critical",
          observation: "Coverage below threshold",
          remediation: "Add unit tests",
          revalidation: "Run coverage gate",
          status: "open",
          evidence: [],
        },
      ],
    });

    const gateNode = buildGateNode(contextFor(task));

    expect(gateNode.status).toBe("warning");
    expect(gateNode.badge?.text).toBe("Pushback: 1 Finding");
    expect(gateNode.metadata?.gateResults).toEqual([
      { gateId: "gate-1", commandId: "C-9", status: "passed" },
    ]);
    expect(gateNode.metadata?.openFindingIds).toEqual(["F-101"]);
    expect(gateNode.metadata?.validatorNodeId).toBe("node-validator-T-pushback");
    // The validator authored the findings, so the gate carries ids and the validator carries bodies.
    expect(gateNode.metadata?.findings).toBeUndefined();
    expect(gateNode.assets).toBeUndefined();
    expect(gateNode.scripts).toBeUndefined();
  });

  test("keeps the findings when there is no validator node to own them", () => {
    const task = makeTask("T-no-validator", {
      status: "changes_requested",
      repair_round: 1,
      findings: [
        {
          id: "F-orphan",
          requirement_id: "REQ-T-no-validator",
          severity: "important",
          observation: "No validator recorded",
          remediation: "n/a",
          revalidation: "n/a",
          status: "open",
          evidence: [],
        },
      ],
    });

    const gateNode = buildGateNode(contextFor(task));
    expect(gateNode.metadata?.validatorNodeId).toBeUndefined();
    expect(gateNode.metadata?.findings).toHaveLength(1);
  });
});
