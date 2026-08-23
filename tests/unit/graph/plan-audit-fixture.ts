import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "../../../olt/scripts/src/contracts/json.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import type { AuditTaskInput } from "../../../olt/scripts/src/graph/plan-audit.ts";

export function task(overrides: Partial<AuditTaskInput> & { taskId: string }): AuditTaskInput {
  return { writeScope: [], deps: [], gate: "bun test tests/unit", ...overrides };
}

// Each test file keeps its own `roots` array and passes it in, rather than this module holding
// the list itself: the suite runs with --no-isolate, under which a module-level array would be
// the same live array in every file that imports it, and one file's afterAll would delete
// temp repos a sibling file's still-running tests depend on.
export function fixtureRepo(roots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "plan-audit-fixture-"));
  roots.push(root);
  return root;
}

export function cleanupFixtureRoots(roots: readonly string[]): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

/** A `gate:prove` verdict shaped exactly like the ones `gateProveCommand` appends via
 *  `appendGateProof` — built directly rather than through a real scratch-copy proof run, since
 *  these tests are exercising `auditPlan`'s consultation of a recorded verdict, not `gate:prove`
 *  itself (that module owns its own tests). */
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
