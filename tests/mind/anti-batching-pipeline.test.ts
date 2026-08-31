import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertAntiBatchingRule,
  detectScopeCollisions,
  partitionCandidatesStrictly,
  partitionGroupedFeedbacksStrictly,
  partitionIntoDisjointWaves,
  planEnhance,
  synthesizeAutonomousTasks,
  validateAntiBatchingIsolation,
  type SmartTaskPlan,
} from "../../olt/scripts/src/mind/tasks/smart/index.ts";
import {
  assertDefectCandidatesIsolated,
  assertDiscriminatingSignOffProofs,
  assertOneToOneImplementerValidatorIsolation,
  partitionDefectsToIsolatedTasks,
} from "../../olt/scripts/src/orchestrator/anti-batching.ts";
import { validateReview } from "../../olt/scripts/src/workflow/review/validate-review.ts";
import { parseCompletionAssessment } from "../../olt/scripts/src/workflow/completion/review-input.ts";
import type { TaskRecord, WorkflowState } from "../../olt/scripts/src/workflow/types.ts";
import type { FeedbackItem } from "../../olt/scripts/src/mind/feedback/queue/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("Strict Anti-Batching Pipeline & 1:1 Isolated Implementer-Validator Verification", () => {
  const testDir = scratchRoot(import.meta.path, "test-anti-batching");
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  }

  function teardown() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  describe("1. Strict 1:1 Feedback & Directive Partitioning", () => {
    it("partitions multiple pending feedback items into strictly isolated 1:1 task nodes", () => {
      setup();
      const feedbacks: FeedbackItem[] = [
        {
          id: "fb-opt-1",
          timestamp: new Date().toISOString(),
          title: "Optimize API Response Latency",
          content: "Reduce payload serialization overhead",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-sec-2",
          timestamp: new Date().toISOString(),
          title: "Harden Bearer Token Validation",
          content: "Verify constant-time comparison on tokens",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-cli-3",
          timestamp: new Date().toISOString(),
          title: "Add Verbose Logging to CLI Commands",
          content: "Support --verbose flag across CLI registry",
          priority: "USER_DIRECTIVE",
          category: "CLI_TOOLING",
          status: "PENDING",
        },
      ];

      writeFileSync(
        feedbackFile,
        feedbacks.map((f) => JSON.stringify(f)).join("\n") + "\n",
        "utf8",
      );

      const result = synthesizeAutonomousTasks({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(result.mode).toBe("feedback_intake");
      expect(result.tasks.length).toBe(3);
      expect(result.anti_batching_enforced).toBe(true);

      // Verify every feedback item is mapped 1:1 to its own distinct task
      for (let i = 0; i < feedbacks.length; i++) {
        const fb = feedbacks[i]!;
        const task = result.tasks.find((t) => t.feedback_id === fb.id);
        expect(task).toBeDefined();
        expect(task?.label).toBe(fb.title);
        expect(task?.write_scope.length).toBeGreaterThan(0);
        expect(task?.assigned_implementer).toBeDefined();
        expect(task?.assigned_validator).toBeDefined();
        expect(task?.assigned_implementer).not.toBe(task?.assigned_validator);
      }

      teardown();
    });

    it("partitionGroupedFeedbacksStrictly enforces 1:1 node isolation and dedicated implementer/validator assignment", () => {
      const feedbacks: FeedbackItem[] = [
        {
          id: "fb-alpha",
          title: "Directive Alpha",
          content: "Directive Alpha content",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-beta",
          title: "Directive Beta",
          content: "Directive Beta content",
          priority: "NORMAL",
          category: "DOCUMENTATION",
          status: "PENDING",
        },
      ];

      const tasks = partitionGroupedFeedbacksStrictly(feedbacks, { baseIdPrefix: "isolated-task" });
      expect(tasks.length).toBe(2);

      expect(tasks[0]!.id).toContain("isolated-task-1-fb-alpha");
      expect(tasks[0]!.assigned_implementer).toBe("implementer-fb-alpha");
      expect(tasks[0]!.assigned_validator).toBe("validator-fb-alpha");

      expect(tasks[1]!.id).toContain("isolated-task-2-fb-beta");
      expect(tasks[1]!.assigned_implementer).toBe("implementer-fb-beta");
      expect(tasks[1]!.assigned_validator).toBe("validator-fb-beta");

      // Verify validation passes cleanly
      const report = validateAntiBatchingIsolation(tasks);
      expect(report.compliant).toBe(true);
      expect(report.violations.length).toBe(0);
      expect(report.isolated_task_count).toBe(2);
    });

    it("partitionCandidatesStrictly partitions defect candidates into 1:1 isolated task nodes", () => {
      const candidates = [
        { id: "cand-1", title: "Memory Leak in Event Chainer", category: "CORE_ENGINE" },
        { id: "cand-2", title: "Missing Error Boundary in Dashboard", category: "ARCHITECTURE" },
      ];

      const plans = partitionCandidatesStrictly(candidates, { baseIdPrefix: "cand-repair" });
      expect(plans.length).toBe(2);

      expect(plans[0]!.candidate_id).toBe("cand-1");
      expect(plans[0]!.assigned_implementer).toBe("implementer-cand-1");
      expect(plans[0]!.assigned_validator).toBe("validator-cand-1");

      expect(plans[1]!.candidate_id).toBe("cand-2");
      expect(plans[1]!.assigned_implementer).toBe("implementer-cand-2");
      expect(plans[1]!.assigned_validator).toBe("validator-cand-2");
    });
  });

  describe("2. Mechanical Rejection of Batched Multi-Item Tasks", () => {
    it("rejects task plans that merge multiple feedback IDs into a single task node", () => {
      const batchedPlan: SmartTaskPlan = {
        id: "task-batched-error",
        label: "Merged Multi-Item Task",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "feedback_intake",
        rationale: "Merged multiple feedback items",
        assigned_implementer: "implementer-1",
        assigned_validator: "validator-1",
        metadata: {
          batched_feedback_ids: ["fb-1", "fb-2", "fb-3"],
        },
      };

      const report = validateAntiBatchingIsolation([batchedPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) => v.includes("illegally merges multiple feedback items")),
      ).toBe(true);

      expect(() => {
        assertAntiBatchingRule([batchedPlan]);
      }).toThrow("Anti-Batching Rule violation");
    });

    it("rejects task plans with multi-item comma-separated feedback IDs or batch titles", () => {
      const commaPlan: SmartTaskPlan = {
        id: "task-comma-fb",
        label: "[Batch: 2 items] Fix multiple bugs",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "feedback_intake",
        rationale: "Fixing fb-1 and fb-2 together",
        assigned_implementer: "implementer-1",
        assigned_validator: "validator-1",
        feedback_id: "fb-1, fb-2",
      };

      const report = validateAntiBatchingIsolation([commaPlan]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("declares multi-item feedback_id"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("title indicates batched execution"))).toBe(
        true,
      );
    });

    it("rejects task plans with empty write scopes violating scope isolation", () => {
      const emptyScopePlan: SmartTaskPlan = {
        id: "task-no-scope",
        label: "Task Without Scope",
        write_scope: [],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "Missing scope",
        assigned_implementer: "implementer-1",
        assigned_validator: "validator-1",
      };

      const report = validateAntiBatchingIsolation([emptyScopePlan]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("empty write scope"))).toBe(true);
    });
  });

  describe("3. 1:1 Implementer and Validator Assignment & Self-Validation Refusal", () => {
    it("rejects task plans where implementer is assigned as validator (self-validation)", () => {
      const selfValidatingPlan: SmartTaskPlan = {
        id: "task-self-val",
        label: "Self-Validating Task",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "Self validation defect",
        assigned_implementer: "agent-alice",
        assigned_validator: "agent-alice",
      };

      const report = validateAntiBatchingIsolation([selfValidatingPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) =>
          v.includes(
            "violates 1:1 isolation: implementer 'agent-alice' cannot act as independent validator",
          ),
        ),
      ).toBe(true);
    });

    it("rejects task plans with missing implementer or validator assignment", () => {
      const missingValidatorPlan: SmartTaskPlan = {
        id: "task-missing-val",
        label: "Missing Validator Task",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "Missing validator",
        assigned_implementer: "agent-alice",
      };

      const report = validateAntiBatchingIsolation([missingValidatorPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) => v.includes("missing an independent Validator assignment")),
      ).toBe(true);
    });

    it("assertOneToOneImplementerValidatorIsolation throws on matching implementer and validator", () => {
      expect(() => {
        assertOneToOneImplementerValidatorIsolation("worker-1", "worker-1", "task-xyz");
      }).toThrow(
        "Anti-batching violation: task 'task-xyz' assigned implementer 'worker-1' cannot validate its own task",
      );

      expect(() => {
        assertOneToOneImplementerValidatorIsolation("worker-1", "val-1", "task-xyz");
      }).not.toThrow();
    });
  });

  describe("4. Independent Write Scope Isolation & Wave Partitioning", () => {
    it("detects scope collisions across tasks with overlapping files", () => {
      const plans: SmartTaskPlan[] = [
        {
          id: "t1",
          label: "Task 1",
          write_scope: ["scripts/src/engine.ts", "scripts/src/shared.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r1",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
        {
          id: "t2",
          label: "Task 2",
          write_scope: ["scripts/src/shared.ts", "scripts/src/utils.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r2",
          assigned_implementer: "impl-2",
          assigned_validator: "val-2",
        },
      ];

      const collisions = detectScopeCollisions(plans);
      expect(collisions.length).toBe(1);
      expect(collisions[0]!.scope).toBe("scripts/src/shared.ts");
      expect(collisions[0]!.task_ids).toEqual(["t1", "t2"]);
    });

    it("partitionIntoDisjointWaves pushes colliding tasks into sequential independent waves", () => {
      const plans: SmartTaskPlan[] = [
        {
          id: "t1",
          label: "Task 1",
          write_scope: ["scripts/src/shared.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r1",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
        {
          id: "t2",
          label: "Task 2",
          write_scope: ["scripts/src/shared.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r2",
          assigned_implementer: "impl-2",
          assigned_validator: "val-2",
        },
        {
          id: "t3",
          label: "Task 3",
          write_scope: ["scripts/src/independent.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r3",
          assigned_implementer: "impl-3",
          assigned_validator: "val-3",
        },
      ];

      const wavePlan = partitionIntoDisjointWaves(plans);
      expect(wavePlan.total_waves).toBe(2);
      expect(wavePlan.waves[0]!.task_ids).toEqual(["t1", "t3"]);
      expect(wavePlan.waves[1]!.task_ids).toEqual(["t2"]);
    });
  });

  describe("5. Anti-Batching Discrimination Proof Enforcement in task:review", () => {
    const mockTaskMultiReq: TaskRecord = {
      id: "task-multi-req",
      title: "Multi-Requirement Task",
      status: "validating",
      write_scope: ["src/feature.ts"],
      gate: "bun test",
      requirement_ids: ["req-1", "req-2"],
      dependencies: [],
      repair_round: 0,
      original_implementer: "impl-1",
    };

    it("rejects passing review when claiming multiple requirements with insufficient/non-discriminating check proofs", () => {
      const batchedReviewAttempt = {
        verdict: "pass",
        requirement_ids: ["req-1", "req-2"],
        checks: [{ command_id: "cmd-generic-check" }], // Only 1 check for 2 distinct requirements
        findings: [],
      };

      expect(() => {
        validateReview(mockTaskMultiReq, batchedReviewAttempt);
      }).toThrow(
        "anti-batching violation: passing review covers 2 requirements but only provides 1 check(s)",
      );
    });

    it("accepts passing review when individual discriminating check proofs per requirement are provided", () => {
      const validDiscriminatingReview = {
        verdict: "pass",
        requirement_ids: ["req-1", "req-2"],
        checks: [{ command_id: "cmd-check-req-1" }, { command_id: "cmd-check-req-2" }],
        findings: [],
      };

      const result = validateReview(mockTaskMultiReq, validDiscriminatingReview);
      expect(result.verdict).toBe("pass");
      expect(result.checks.length).toBe(2);
    });

    it("rejects passing review when resolved findings lack individual command evidence", () => {
      const invalidResolutionReview = {
        verdict: "pass",
        requirement_ids: ["req-1", "req-2"],
        checks: [{ command_id: "cmd-check-req-1" }, { command_id: "cmd-check-req-2" }],
        findings: [],
        resolved_findings: [
          {
            finding_id: "FINDING-1",
            method: "Fixed defect",
            evidence: [], // Missing evidence
          },
        ],
      };

      expect(() => {
        validateReview(mockTaskMultiReq, invalidResolutionReview);
      }).toThrow("revalidation evidence for FINDING-1 must contain");
    });

    it("assertDiscriminatingSignOffProofs utility function throws appropriately on insufficient proofs", () => {
      expect(() => {
        assertDiscriminatingSignOffProofs(
          "task-test",
          ["req-1", "req-2", "req-3"],
          [{ command_id: "cmd-1" }],
        );
      }).toThrow(
        "Anti-batching violation: task 'task-test' covers 3 requirements but only provides 1 check(s)",
      );

      expect(() => {
        assertDiscriminatingSignOffProofs(
          "task-test",
          ["req-1", "req-2"],
          [{ command_id: "cmd-1" }, { command_id: "cmd-2" }],
        );
      }).not.toThrow();
    });
  });

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
        status: "clean",
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: [
          {
            requirement_id: "REQ-PERF",
            status: "satisfied",
            evidence: [
              { kind: "command", reference: "cmd-general-test", observation: "All tests pass" },
            ],
          },
          {
            requirement_id: "REQ-SECURITY",
            status: "satisfied",
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
    });

    it("accepts clean completion review when each requirement carries distinct discriminating test evidence", () => {
      const validDiscriminatingCriticInput = {
        summary: "Clean completion assessment with discriminating proofs",
        status: "clean",
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: [
          {
            requirement_id: "REQ-PERF",
            status: "satisfied",
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
            status: "satisfied",
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
    });
  });

  describe("7. Orchestrator Defect Candidate Partitioning", () => {
    it("partitionDefectsToIsolatedTasks creates 1:1 isolated repair tasks from findings", () => {
      const findings = [
        {
          id: "FINDING-NULL-PTR",
          requirement_id: "REQ-1",
          severity: "critical" as const,
          observation: "Null pointer when payload is empty in src/parser.ts",
          remediation: "Add null check in src/parser.ts",
          revalidation: "bun test tests/unit/parser.test.ts",
          file_paths: ["src/parser.ts"],
        },
        {
          id: "FINDING-RACE-COND",
          requirement_id: "REQ-2",
          severity: "important" as const,
          observation: "Race condition in transaction ledger in src/ledger.ts",
          remediation: "Add mutex lock in src/ledger.ts",
          revalidation: "bun test tests/unit/ledger.test.ts",
          file_paths: ["src/ledger.ts"],
        },
      ];

      const repairTasks = partitionDefectsToIsolatedTasks(findings, { roundNumber: 2 });
      expect(repairTasks.length).toBe(2);

      expect(repairTasks[0]!.id).toContain("repair-r2-1-finding-null-ptr");
      expect(repairTasks[0]!.assigned_implementer).toBe("implementer-finding-null-ptr");
      expect(repairTasks[0]!.assigned_validator).toBe("validator-finding-null-ptr");
      expect(repairTasks[0]!.priority).toBe("CRITICAL");
      expect(repairTasks[0]!.write_scope).toEqual(["src/parser.ts"]);

      expect(repairTasks[1]!.id).toContain("repair-r2-2-finding-race-cond");
      expect(repairTasks[1]!.assigned_implementer).toBe("implementer-finding-race-cond");
      expect(repairTasks[1]!.assigned_validator).toBe("validator-finding-race-cond");
      expect(repairTasks[1]!.priority).toBe("HIGH");
      expect(repairTasks[1]!.write_scope).toEqual(["src/ledger.ts"]);

      const report = validateAntiBatchingIsolation(repairTasks);
      expect(report.compliant).toBe(true);
      expect(report.isolated_task_count).toBe(2);
    });

    it("assertDefectCandidatesIsolated checks for duplicate finding IDs", () => {
      const duplicateFindings = [
        {
          id: "FINDING-1",
          requirement_id: "REQ-1",
          severity: "minor" as const,
          observation: "obs 1",
          remediation: "rem 1",
        },
        {
          id: "FINDING-1",
          requirement_id: "REQ-2",
          severity: "minor" as const,
          observation: "obs 2",
          remediation: "rem 2",
        },
      ];

      expect(() => {
        assertDefectCandidatesIsolated(duplicateFindings);
      }).toThrow("Duplicate defect candidate id: FINDING-1");
    });
  });

  describe("8. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    it("verifies zero TypeScript any and zero suppressions across all anti-batching pipeline source and test files", () => {
      const filesToAudit = [
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/tasks/smart/index.ts",
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/orchestrator/anti-batching.ts",
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/orchestrator/defect-synthesizer.ts",
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/workflow/review/validate-review.ts",
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/workflow/completion/review-input.ts",
        "/Users/onurseckinsenoglu/repos/skills/tests/unit/mind/anti-batching-pipeline.test.ts",
      ];

      const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionPattern = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
      );

      for (const filePath of filesToAudit) {
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

          expect(anyPattern.test(line)).toBe(false);
          expect(suppressionPattern.test(line)).toBe(false);
        }
      }
    });
  });
});
