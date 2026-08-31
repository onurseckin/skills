import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import type { AuditTaskInput } from "../../../olt/scripts/src/graph/plan-audit.ts";

export function task(overrides: Partial<AuditTaskInput> & { taskId: string }): AuditTaskInput {
  return { writeScope: [], deps: [], gate: "bun test tests/unit", ...overrides };
}

export function fixtureRepo(_roots?: string[]): string {
  return "/virtual/repo/plan-audit-fixture";
}

export function cleanupFixtureRoots(_roots?: readonly string[]): void {
  // Zero-disk implementation: no temporary filesystem resources to release
}

/** A `gate:prove` verdict shaped exactly like the ones `gateProveCommand` appends via
 *  `appendGateProof` — built directly rather than through a real scratch-copy proof run. */
export function gateProof(
  overrides: Partial<GateProofRecord> &
    Pick<GateProofRecord, "task_id" | "gate_argv" | "write_scope">,
): GateProofRecord {
  return {
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-01-01T00:00:00.000Z",
    actor: "coordinator",
    ...overrides,
  };
}

export function runStateWithProofs(records: readonly GateProofRecord[]): JsonObject {
  const state: JsonObject = {};
  for (const record of records) appendGateProof(state, record);
  return state;
}
