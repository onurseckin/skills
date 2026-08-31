import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as reviewModule from "../../olt/scripts/src/workflow/review/index.ts";
import {
  beginValidation,
  recordProbe,
  recordReview,
  recordReviewVerdict,
} from "../../olt/scripts/src/workflow/review/index.ts";
import { claimTask } from "../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../olt/scripts/src/workflow/submission/submit.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../olt/scripts/src/graph/gate-proof.ts";
import {
  validateFacadeExports,
  validateZeroCommentsInCode,
} from "../../olt/scripts/src/validation/coding-conventions.ts";
import {
  at,
  registerCommand,
  registerTaskPacket,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";

const clock = at("2026-08-20T10:00:00.000Z");

const testReport = {
  summary: "implementation complete",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

const probeDemand = {
  id: "probe-T-1-01-1",
  class: "probe_demand" as const,
  requirement_id: "R-1",
  severity: "minor" as const,
  observation: "verify edge condition handling",
  evidence: [{ kind: "demand", detail: "edge payload", evidence_class: "agent_reported" }],
  remediation: "provide discriminating command proof",
  revalidation: "cite command id verifying edge condition",
};

const defectFinding = {
  id: "F-1",
  class: "defect" as const,
  requirement_id: "R-1",
  severity: "important" as const,
  observation: "null input causes crash",
  evidence: [{ path: "a.ts" }],
  remediation: "guard against null input",
  revalidation: "bun test",
};

function setupSubmittedTask(): TestPort {
  const port = new TestPort(workflowState());
  const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", token, testReport, clock);
  return port;
}

function acquireValidationToken(port: TestPort, validatorId: string): string {
  registerCommand(port, `C-${validatorId}`, validatorId);
  const state = beginValidation(port, "T-1", validatorId, clock);
  registerTaskPacket(
    port,
    "validator",
    validatorId,
    state.tasks["T-1"]!.validations!.at(-1)!.attempt,
  );
  const token = state.tasks["T-1"]!.validation_token;
  if (typeof token !== "string") throw new TypeError("validation token missing");
  return token;
}

function seedGateProof(port: TestPort): void {
  const proofRecord: GateProofRecord = {
    task_id: "T-1",
    gate_argv: [...TEST_GATE_ARGV],
    write_scope: ["src/owned"],
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-20T10:00:00.000Z",
    actor: "coordinator",
  };
  port.transact("coordinator", "gate-proved", { task_id: "T-1" }, (draft) => {
    appendGateProof(draft, proofRecord);
  });
}

describe("workflow/review/index.ts: recordReviewVerdict deduplication & canonical export", () => {
  test("exports recordReviewVerdict as a canonical named function reference identical to recordReview", () => {
    expect(typeof recordReviewVerdict).toBe("function");
    expect(typeof recordReview).toBe("function");
    expect(recordReviewVerdict).toBe(recordReview);
  });

  test("contains unique named export recordReviewVerdict in the review module facade without duplicates", () => {
    const keys = Object.keys(reviewModule);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
    expect(keys).toContain("recordReviewVerdict");
    expect(keys).toContain("recordReview");
    expect(reviewModule.recordReviewVerdict).toBe(reviewModule.recordReview);
  });

  test("verifies workflow/review/index.ts conforms to modularity facade and zero-comment invariants", () => {
    const indexPath = resolve(process.cwd(), "olt/scripts/src/workflow/review/index.ts");
    const content = readFileSync(indexPath, "utf8");
    const lines = content.split("\n");

    expect(lines.length).toBeLessThanOrEqual(300);

    const commentResult = validateZeroCommentsInCode(content, indexPath);
    expect(commentResult.violations).toHaveLength(0);

    const facadeResult = validateFacadeExports(content, indexPath);
    expect(facadeResult.violations).toHaveLength(0);

    const matches = content.match(/\brecordReviewVerdict\b/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(1);
  });

  test("executes recordReviewVerdict for a reject verdict transitioning task to changes_requested", () => {
    const port = setupSubmittedTask();
    const token = acquireValidationToken(port, "validator-1");

    const rejectPayload = {
      verdict: "reject" as const,
      validation_token: token,
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator-1" }],
      findings: [defectFinding],
    };

    const finalState = recordReviewVerdict(port, "T-1", "validator-1", rejectPayload, clock);

    const task = finalState.tasks["T-1"]!;
    expect(task.status).toBe("changes_requested");
    expect(task.repair_round).toBe(1);
    expect(task.repair_assignee).toBe("implementer");
    expect(task.findings).toHaveLength(1);
    expect(task.findings?.[0]?.status).toBe("open");
  });

  test("executes recordReviewVerdict for a pass verdict transitioning task to validated", () => {
    const port = setupSubmittedTask();
    const token = acquireValidationToken(port, "validator-1");

    recordProbe(
      port,
      "T-1",
      "validator-1",
      { validation_token: token, findings: [probeDemand] },
      clock,
    );
    seedGateProof(port);

    const passPayload = {
      verdict: "pass" as const,
      validation_token: token,
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator-1" }],
      findings: [],
      resolved_findings: [
        {
          finding_id: probeDemand.id,
          method: "probe_demand_answered",
          evidence: [{ command_id: "C-validator-1" }],
        },
      ],
    };

    const finalState = recordReviewVerdict(port, "T-1", "validator-1", passPayload, clock, 6, 1);

    const task = finalState.tasks["T-1"]!;
    expect(task.status).toBe("validated");
    const open = (task.findings ?? []).filter((f) => f.status === "open");
    expect(open).toHaveLength(0);
  });

  test("throws INVALID_STATE error when recordReviewVerdict is called with an invalid validation token", () => {
    const port = setupSubmittedTask();
    acquireValidationToken(port, "validator-1");

    const invalidPayload = {
      verdict: "pass" as const,
      validation_token: "invalid-token",
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator-1" }],
      findings: [],
    };

    expect(() => recordReviewVerdict(port, "T-1", "validator-1", invalidPayload, clock)).toThrow(
      /validator authentication token is invalid/,
    );
  });
});
