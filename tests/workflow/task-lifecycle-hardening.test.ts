import { describe, expect, test } from "bun:test";
import { evidenced } from "../../olt/scripts/src/core/contracts/index.ts";
import { claimTask } from "../../olt/scripts/src/workflow/lease/claim.ts";
import { recoverStale } from "../../olt/scripts/src/workflow/lease/recover-stale.ts";
import { submitTask } from "../../olt/scripts/src/workflow/submission/submit.ts";
import { beginValidation } from "../../olt/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../olt/scripts/src/workflow/review/record-review.ts";
import { recordMicroCycleCritique } from "../../olt/scripts/src/workflow/review/micro-cycle.ts";
import {
  assertGateProofFalsifiable,
  isBaseShaReconciled,
} from "../../olt/scripts/src/workflow/review/pass-preconditions.ts";
import { openValidations } from "../../olt/scripts/src/workflow/review/validation-state.ts";
import { appendGateProof } from "../../olt/scripts/src/graph/gate-proof.ts";
import {
  registerCommand,
  registerTaskPacket,
  TestPort,
  TEST_GATE_ARGV,
  workflowState,
} from "./test-port.ts";

const validReport = (summary: string) => ({
  summary,
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/file.ts"],
  checks: [{ command: "bun test", status: "passed", evidence: "command:C-1" }],
  evidence: [{ kind: "diff", path: "src/owned/file.ts" }],
});

describe("Domain 13 Hardening: Task Lifecycle & State Machines", () => {
  test("Challenge 1: Micro-cycle role packet authority continuity", () => {
    const state = workflowState();
    const port = new TestPort(state);

    // Initial claim and packet publication for attempt 1
    const { token: claimToken } = claimTask(port, "T-1", "worker-1", "implementer", {
      writeScopeContentHash: evidenced("hash-init", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "worker-1", 1, "T-1");

    // Implementer submits attempt 1
    submitTask(
      port,
      "T-1",
      "worker-1",
      claimToken,
      validReport("First implementation pass"),
      undefined,
      {
        currentWriteScopeContentHash: evidenced("hash-v1", "harness_observed"),
      },
    );

    // Validator issues a micro-cycle critique (in-lease/repair attempt continuity)
    const critiqueResult = recordMicroCycleCritique(
      port,
      "T-1",
      "val-1",
      "Please fix edge case handling in src/owned/file.ts",
      { remediation: "Add bounds check" },
    );

    const taskAfterCritique = port.read().tasks["T-1"]!;
    expect(taskAfterCritique.status).toBe("leased");
    expect(taskAfterCritique.micro_cycle_round).toBe(1);
    expect(critiqueResult.repairToken).toBeDefined();

    // The implementer can submit attempt 2 under micro-cycle without packet authority rejection
    const repairToken = critiqueResult.repairToken!;
    expect(() => {
      submitTask(
        port,
        "T-1",
        "worker-1",
        repairToken,
        validReport("Fixed edge case with bounds check"),
        undefined,
        {
          currentWriteScopeContentHash: evidenced("hash-v2", "harness_observed"),
        },
      );
    }).not.toThrow();

    const taskAfterRepairSubmit = port.read().tasks["T-1"]!;
    expect(taskAfterRepairSubmit.status).toBe("submitted");
  });

  test("Challenge 3: Base SHA drift reconciliation in shared roots", () => {
    const state = workflowState();
    const port = new TestPort(state);

    // Claim task at base SHA "sha-initial"
    claimTask(port, "T-1", "worker-1", "implementer", {
      claimedBaseSha: evidenced("sha-initial", "harness_observed"),
    });

    const task = port.read().tasks["T-1"]!;

    // Upstream commit happened, current_repository_binding head is now "sha-concurrent-commit"
    state.current_repository_binding = {
      schema: "harness.repository-binding" as const,
      version: 1 as const,
      inspection_sha256: "a".repeat(64),
      git_identity_sha256: "b".repeat(64),
      content_sha256: "c".repeat(64),
      head_sha: "sha-concurrent-commit",
      file_count: 5,
      total_bytes: 500,
    };

    // Proof generated against concurrent HEAD commit
    expect(isBaseShaReconciled("sha-concurrent-commit", "sha-initial", task, state)).toBe(true);

    // Proof against initial base also reconciled
    expect(isBaseShaReconciled("sha-initial", "sha-initial", task, state)).toBe(true);

    // Proof against HEAD keyword reconciled
    expect(isBaseShaReconciled("HEAD", "sha-initial", task, state)).toBe(true);

    // Falsifiable proof recorded against concurrent commit head satisfies gate falsifiability
    appendGateProof(state, {
      task_id: "T-1",
      gate_argv: [...TEST_GATE_ARGV],
      write_scope: ["src/owned"],
      base: "sha-concurrent-commit",
      falsifiable: true,
      exit_code: 1,
      timed_out: false,
      proved_at: "2026-08-13T12:00:00.000Z",
      actor: "coordinator",
    });

    expect(() => assertGateProofFalsifiable(state, task)).not.toThrow();
  });

  test("Challenge 4: Multi-domain validation lifecycle isolation", () => {
    const state = workflowState();
    const port = new TestPort(state);

    // Task with multi-domain scope (code-quality + ui-design)
    state.tasks["T-1"]!.write_scope = ["src/core/logic.ts", "src/ui/component.html"];
    state.tasks["T-1"]!.status = "submitted";
    state.tasks["T-1"]!.original_implementer = "worker-1";

    // Register valid check command for val-core
    registerCommand(port, "C-core", "val-core", { gate_id: "G-1" });

    // Begin validation for code-quality domain
    const state1 = beginValidation(port, "T-1", "val-core", undefined, 1200, "code-quality");
    const tokenCore = state1.tasks["T-1"]!.validation_token as string;
    registerTaskPacket(port, "validator", "val-core", 1, "T-1");

    // Begin validation for ui-design domain in parallel
    const state2 = beginValidation(port, "T-1", "val-ui", undefined, 1200, "ui-design");
    const _tokenUi = state2.tasks["T-1"]!.validation_token as string;
    registerTaskPacket(port, "validator", "val-ui", 1, "T-1");

    expect(openValidations(port.read().tasks["T-1"]!).length).toBe(2);

    recordReview(port, "T-1", "val-core", {
      validation_token: tokenCore,
      verdict: "reject",
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "critical",
          observation: "Logic flaw in core",
          evidence: [{ kind: "command", command_id: "C-core" }],
          remediation: "Fix logic",
          revalidation: "Re-run test",
          status: "open",
        },
      ],
      checks: [{ command_id: "C-core" }],
      requirement_ids: ["R-1"],
    });

    const taskAfterReject = port.read().tasks["T-1"]!;
    expect(taskAfterReject.status).toBe("changes_requested");

    // Core validation was archived to history with reject verdict
    const history = taskAfterReject.validation_history ?? [];
    expect(history.some((v) => v.validator_id === "val-core" && v.verdict === "reject")).toBe(true);

    // UI validation was properly archived to history when reject ended the round
    expect(history.some((v) => v.validator_id === "val-ui")).toBe(true);
    expect(openValidations(taskAfterReject).length).toBe(0);
  });

  test("Challenge 5: Stale lease recovery with write-scope baseline preservation", () => {
    const state = workflowState();
    const port = new TestPort(state);

    // Attempt 1: Initial claim with baseline hash H0
    const { token: _token1 } = claimTask(port, "T-1", "worker-1", "implementer", {
      writeScopeContentHash: evidenced("hash-baseline-H0", "harness_observed"),
      leaseSeconds: 5,
    });
    registerTaskPacket(port, "implementer", "worker-1", 1, "T-1");

    const taskInitial = port.read().tasks["T-1"]!;
    expect(taskInitial.initial_write_scope_content_hash?.value).toBe("hash-baseline-H0");

    // Worker edits files -> on disk content is now H1 (different from baseline H0)
    // Worker crashes/lease expires -> Stale recovery runs
    const expiredClock = { now: () => new Date(Date.now() + 60_000) };
    recoverStale(port, "system", expiredClock, { graceSeconds: 0 });

    const taskRecovered = port.read().tasks["T-1"]!;
    expect(taskRecovered.status).toBe("retry_ready");
    expect(taskRecovered.lease).toBeUndefined();
    // Baseline is preserved across stale recovery
    expect(taskRecovered.initial_write_scope_content_hash?.value).toBe("hash-baseline-H0");

    // Attempt 2: Worker reclaims task (claim hash is now H1 because edits were preserved on disk)
    const { token: token2 } = claimTask(port, "T-1", "worker-1", "implementer", {
      writeScopeContentHash: evidenced("hash-edited-H1", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "worker-1", 2, "T-1");

    // Worker submits with current disk hash H1 (no new edits needed since crash, but work was done vs baseline)
    expect(() => {
      submitTask(
        port,
        "T-1",
        "worker-1",
        token2,
        validReport("Submitting fix that was written prior to recovery"),
        undefined,
        {
          currentWriteScopeContentHash: evidenced("hash-edited-H1", "harness_observed"),
        },
      );
    }).not.toThrow();

    const finalTask = port.read().tasks["T-1"]!;
    expect(finalTask.status).toBe("submitted");
  });
});
