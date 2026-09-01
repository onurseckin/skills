import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateCriticAntiBatching,
  validateReviewAntiBatching,
} from "../../../olt/scripts/src/validation/anti-batching.ts";
import {
  assertAntiBatchingRule,
  detectScopeCollisions,
  partitionCandidatesStrictly,
  partitionGroupedFeedbacksStrictly,
  partitionIntoDisjointWaves,
  synthesizeAutonomousTasks,
  validateAntiBatchingIsolation,
  type SmartTaskPlan,
} from "../../../olt/scripts/src/mind/tasks/smart/index.ts";
import {
  assertDefectCandidatesIsolated,
  assertDiscriminatingSignOffProofs,
  assertOneToOneImplementerValidatorIsolation,
  partitionDefectsToIsolatedTasks,
} from "../../../olt/scripts/src/orchestrator/anti-batching.ts";
import { validateReview } from "../../../olt/scripts/src/workflow/review/validate-review.ts";
import { parseCompletionAssessment } from "../../../olt/scripts/src/workflow/completion/review-input.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { tmpdir } from "node:os";

describe("Strict Anti-Batching Pipeline & 1:1 Isolated Implementer-Validator Verification", () => {
  const testDir = join(
    tmpdir(),
    "test-validation-anti-batching-" + Math.random().toString(36).slice(2),
  );
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");

  function setup(): void {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  }

  function teardown(): void {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }
  describe("6. Anti-Batching Discrimination Proof Enforcement in critic:review", () => {
    const mockWorkflowState: WorkflowState = {
      event_head: "00000000",
      graph_revision: 1,
      tasks: {},
      requirements: [
        {
          id: "REQ-PERF",
          statement: "Latency must be < 50ms",
          status: "satisfied",
          evidence: [],
          history: [],
        },
        {
          id: "REQ-SECURITY",
          statement: "Bearer tokens must be verified in constant time",
          status: "satisfied",
          evidence: [],
          history: [],
        },
      ],
      gates: [],
      commands: {},
    };

    it("rejects clean completion review when multiple disparate requirements reuse identical non-discriminating evidence", () => {
      const batchedCriticInput = {
        summary: "Clean completion assessment",
        status: "clean" as const,
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: [
          {
            requirement_id: "REQ-PERF",
            status: "satisfied" as const,
            evidence: [
              { kind: "command", reference: "cmd-general-test", observation: "All tests pass" },
            ],
          },
          {
            requirement_id: "REQ-SECURITY",
            status: "satisfied" as const,
            evidence: [
              { kind: "command", reference: "cmd-general-test", observation: "All tests pass" }, // Reusing identical evidence
            ],
          },
        ],
        residual_risks: [],
      };

      expect(() => {
        parseCompletionAssessment(mockWorkflowState, batchedCriticInput);
      }).toThrow(
        "anti-batching violation: critic sign-off cannot claim multiple disparate feedback items/requirements without individual discriminating test proofs per item",
      );

      const res = validateCriticAntiBatching(mockWorkflowState, batchedCriticInput);
      expect(res.valid).toBe(false);
      expect(res.violations.length).toBeGreaterThan(0);
    });

    it("accepts clean completion review when each requirement carries distinct discriminating test evidence", () => {
      const validDiscriminatingCriticInput = {
        summary: "Clean completion assessment with discriminating proofs",
        status: "clean" as const,
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: [
          {
            requirement_id: "REQ-PERF",
            status: "satisfied" as const,
            evidence: [
              {
                kind: "command",
                reference: "cmd-perf-benchmark",
                observation: "Latency measured at 18ms",
              },
            ],
          },
          {
            requirement_id: "REQ-SECURITY",
            status: "satisfied" as const,
            evidence: [
              {
                kind: "command",
                reference: "cmd-crypto-timing-test",
                observation: "Constant-time verified",
              },
            ],
          },
        ],
        residual_risks: [],
      };

      const assessment = parseCompletionAssessment(
        mockWorkflowState,
        validDiscriminatingCriticInput,
      );
      expect(assessment.findings.length).toBe(0);
      expect(assessment.requirement_proofs.length).toBe(2);
      expect(assessment.requirement_proofs[0]!.status).toBe("satisfied");
      expect(assessment.requirement_proofs[1]!.status).toBe("satisfied");

      const res = validateCriticAntiBatching(mockWorkflowState, validDiscriminatingCriticInput);
      expect(res.valid).toBe(true);
      expect(res.violations.length).toBe(0);
    });

    it("rejects review when a pairwise subset of disparate requirements share identical evidence", () => {
      const pairwiseBatchedCriticInput = {
        summary: "Partial collision assessment",
        status: "clean" as const,
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: [
          {
            requirement_id: "REQ-PERF",
            status: "satisfied" as const,
            evidence: [{ kind: "command", reference: "cmd-perf", observation: "18ms" }],
          },
          {
            requirement_id: "REQ-SECURITY",
            status: "satisfied" as const,
            evidence: [
              { kind: "command", reference: "cmd-shared-token", observation: "Token verified" },
            ],
          },
          {
            requirement_id: "REQ-AUTH",
            status: "satisfied" as const,
            evidence: [
              { kind: "command", reference: "cmd-shared-token", observation: "Auth verified" },
            ], // Collision with REQ-SECURITY
          },
        ],
        residual_risks: [],
      };

      const res = validateCriticAntiBatching(mockWorkflowState, pairwiseBatchedCriticInput);
      expect(res.valid).toBe(false);
      expect(
        res.violations.some((v) => v.includes("reuses identical evidence as 'REQ-SECURITY'")),
      ).toBe(true);
    });

    it("rejects task review when checks count meets requirement count but reuses duplicate command IDs", () => {
      const task: TaskRecord = {
        id: "task-multi-req",
        category: "implementation",
        created_at: new Date().toISOString(),
        description: "Multi req task",
        kind: "task",
        priority: "HIGH",
        status: "claimed",
        summary: "Task covering 2 reqs",
        updated_at: new Date().toISOString(),
        requirement_ids: ["REQ-1", "REQ-2"],
      };

      const reviewPayload = {
        verdict: "pass" as const,
        requirement_ids: ["REQ-1", "REQ-2"],
        checks: [{ command_id: "cmd-duplicate-id" }, { command_id: "cmd-duplicate-id" }],
      };

      const res = validateReviewAntiBatching(task, reviewPayload);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes("duplicate command IDs detected"))).toBe(true);
    });
  });
});
