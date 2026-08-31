import { expect } from "bun:test";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { nextActions } from "../../../olt/scripts/src/reporting/next-actions.ts";
import { dispatchFailures } from "../core/dispatchable.ts";

export const RUN = "/repo/.capsules/run";
export const ENTRYPOINT = "/skill/olt/scripts/harness.ts";

const HELD = new Set(["leased", "running"]);

export function view(status: string, overrides: JsonObject = {}): JsonObject {
  return {
    tasks: [
      {
        id: "T-1",
        status,
        owner: HELD.has(status) ? "worker" : null,
        role: HELD.has(status) ? "implementer" : null,
        attempt: 1,
        repair_assignee: status === "changes_requested" ? "worker" : null,
        original_implementer: "worker",
        requirement_ids: ["R-1"],
        gate_results: [],
        open_finding_ids: [],
        probe_round: 0,
        validation:
          status === "validating"
            ? [{ validator_id: "validator", domain: "code-quality", attempt: 1 }]
            : [],
      },
    ],
    gates: [
      {
        id: "G-task",
        scope: "task",
        cwd: ".",
        command: ["bun", "test", "focused"],
        requirement_ids: ["R-1"],
        mandatory: true,
      },
      {
        id: "G-run",
        scope: "run",
        cwd: "packages/api",
        command: ["bun", "test", "all"],
        requirement_ids: [],
        mandatory: true,
      },
    ],
    packets: [],
    commands: [],
    branches: [],
    completion_critic: null,
    completion_review: null,
    completion_remediations: [],
    completion_result: null,
    requirements: [],
    orphan_evidence: [],
    orphan_evidence_dispositions: [],
    ...overrides,
  };
}

export interface RenderedActions {
  argv: string[][];
  unavailable: string[];
  text: string;
}

export function actions(
  state: JsonObject,
  agents: readonly AgentGrantRecord[] = [],
): RenderedActions {
  const result = nextActions(RUN, ENTRYPOINT, state, agents);
  // Nothing this module prints may be an invocation the CLI would refuse.
  expect(dispatchFailures(result.argv)).toEqual([]);
  return { ...result, text: result.argv.map((argv) => argv.join(" ")).join("\n") };
}
