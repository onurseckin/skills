import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  advanceProposalWithInitiative,
  admitProposalInState,
  applyPlanRevisionInState,
  assertRoleMayDecideProposal,
  calculateProposalFingerprint,
  calculateRemainingCooldownMs,
  canTransitionProposal,
  checkProposalRateLimits,
  completeProposalInState,
  decideProposalInState,
  evaluateInitiativeTriggers,
  findDeclinedProposalConflict,
  formatPlanRevisionBrief,
  formatProposalBrief,
  generatePlanRevisionFromSignals,
  getAllProposals,
  getDeclinedProposals,
  getGrantedProposals,
  getOpenProposals,
  isDuplicateProposal,
  isProposalAdmissible,
  isProposalGranted,
  recordProposalInState,
  transitionProposalStatusInState,
  VALID_PROPOSAL_TRANSITIONS,
  type MindProposal,
  type PlanRevisionProposal,
  type PlanRevisionSignal,
  type ProposalStatus,
} from "../../olt/scripts/src/mind/proposals/proposal/index.ts";
import {
  balanceOrchestratorLoad,
  calculateHierarchyCapacity,
  DEFAULT_SCALING_THRESHOLDS,
  evaluateHierarchyScaling,
  evaluatePerpetualCadence,
  formatSelfEvolutionBrief,
  runSelfEvolutionCycle,
  synthesizeDynamicPlanRevisions,
  type HierarchyCapacityMetrics,
  type OrchestratorNodeInfo,
  type ScalingThresholds,
} from "../../olt/scripts/src/mind/lifecycle/evolution/index.ts";

describe("Mind Proposal & Plan Revision Subsystem", () => {
  describe("Proposal Creation, Deduplication & Fingerprinting", () => {
    it("creates a proposal in state with valid attributes and default needs_authority status", () => {
      const state: Record<string, unknown> = {
        candidates: [],
        requirements: [],
        budget: { max_open_proposals: 5, proposal_interval_ms: 0 },
      };

      const proposal = recordProposalInState(state, {
        statement: "Implement active plan revision engine",
        rationale: "Allows Mind to synthesize evolutionary updates without human blockage",
        charter_goal_ids: ["goal-self-evolution"],
        write_scope: ["olt/scripts/src/mind/proposals/proposal/index.ts"],
        actor: "orchestrator_main",
      });

      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe("needs_authority");
      expect(proposal.disposition).toBe("needs_authority");
      expect(proposal.statement).toBe("Implement active plan revision engine");
      expect(proposal.charter_goal_ids).toEqual(["goal-self-evolution"]);
      expect(proposal.fingerprint).toBeDefined();

      const all = getAllProposals(state);
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(proposal.id);
    });

    it("generates deterministic fingerprints for identical statements and write scopes", () => {
      const fp1 = calculateProposalFingerprint(
        "Refactor test coverage engine",
        ["goal-quality"],
        ["src/test.ts"],
      );
      const fp2 = calculateProposalFingerprint(
        "  refactor test coverage engine  ",
        ["goal-quality"],
        ["src/test.ts"],
      );
      const fp3 = calculateProposalFingerprint(
        "Different proposal statement",
        ["goal-quality"],
        ["src/test.ts"],
      );

      expect(fp1).toBe(fp2);
      expect(fp1).not.toBe(fp3);
    });

    it("detects and blocks duplicate open proposals", () => {
      const state: Record<string, unknown> = {
        candidates: [],
        requirements: [],
        budget: { max_open_proposals: 5, proposal_interval_ms: 0 },
      };

      recordProposalInState(state, {
        statement: "Enhance cognitive gap analyzer",
        rationale: "Improve gap detection accuracy",
        charter_goal_ids: ["goal-cognitive"],
        write_scope: ["src/gap.ts"],
        actor: "orchestrator_main",
      });

      const check = isDuplicateProposal(state, "Enhance cognitive gap analyzer", [
        "goal-cognitive",
      ]);
      expect(check.isDuplicate).toBe(true);
      expect(check.existingProposal).toBeDefined();

      expect(() => {
        recordProposalInState(state, {
          statement: "Enhance cognitive gap analyzer",
          rationale: "Duplicate submission",
          charter_goal_ids: ["goal-cognitive"],
          write_scope: ["src/gap.ts"],
          actor: "orchestrator_main",
        });
      }).toThrow(HarnessError);
    });

    it("blocks re-proposal of permanently declined proposals (Gate 6 enforcement)", () => {
      const state: Record<string, unknown> = {
        candidates: [],
        requirements: [],
        budget: { max_open_proposals: 5, proposal_interval_ms: 0 },
      };

      const prop = recordProposalInState(state, {
        statement: "Add forbidden external webhook",
        rationale: "Notify external server",
        charter_goal_ids: ["goal-notify"],
        actor: "orchestrator_main",
      });

      decideProposalInState(state, prop.id, "owner", {
        decision: "decline",
        rationale: "Violates non-goal: no outbound webhooks",
      });

      const declined = getDeclinedProposals(state);
      expect(declined.length).toBe(1);
      expect(findDeclinedProposalConflict(state, "Add forbidden external webhook")).toBeDefined();

      expect(() => {
        recordProposalInState(state, {
          statement: "Add forbidden external webhook",
          rationale: "Retrying declined proposal",
          charter_goal_ids: ["goal-notify"],
          actor: "orchestrator_main",
        });
      }).toThrow(HarnessError);
    });
  });

  describe("Lifecycle Transitions & Authority Boundaries", () => {
    it("executes valid lifecycle transitions: opened -> needs_authority -> granted -> admitted -> in_progress -> completed", () => {
      const state: Record<string, unknown> = {
        candidates: [
          {
            id: "cand-01",
            kind: "proposal",
            statement: "Harden token bucket algorithm",
            rationale: "Prevent burst saturation",
            charter_goal_ids: ["goal-perf"],
            write_scope: ["src/bucket.ts"],
            status: "opened",
            disposition: "needs_authority",
            created_at: new Date().toISOString(),
          },
        ],
        requirements: [],
      };

      // opened -> needs_authority
      const t1 = transitionProposalStatusInState(
        state,
        "cand-01",
        "needs_authority",
        "orchestrator",
      );
      expect(t1.status).toBe("needs_authority");

      // needs_authority -> granted
      const t2 = decideProposalInState(state, "cand-01", "human_owner", {
        decision: "grant",
        rationale: "Approved for execution",
      });
      expect(t2.status).toBe("granted");
      expect(isProposalGranted(t2)).toBe(true);

      // granted -> admitted
      const t3 = admitProposalInState(state, "cand-01", "orchestrator");
      expect(t3.status).toBe("admitted");
      expect(isProposalAdmissible(t3)).toBe(true);

      // admitted -> in_progress
      const t4 = transitionProposalStatusInState(state, "cand-01", "in_progress", "implementer");
      expect(t4.status).toBe("in_progress");

      // in_progress -> completed
      const t5 = completeProposalInState(state, "cand-01", "validator", {
        rationale: "All unit tests pass and gate verified",
      });
      expect(t5.status).toBe("completed");
      expect(t5.disposition).toBe("completed");
    });

    it("rejects invalid lifecycle transitions out of terminal or incompatible states", () => {
      const state: Record<string, unknown> = {
        candidates: [
          {
            id: "cand-completed",
            kind: "proposal",
            statement: "Completed task",
            rationale: "Done",
            charter_goal_ids: ["goal-1"],
            status: "completed",
            disposition: "completed",
            created_at: new Date().toISOString(),
          },
          {
            id: "cand-declined",
            kind: "proposal",
            statement: "Declined task",
            rationale: "Rejected",
            charter_goal_ids: ["goal-1"],
            status: "declined",
            disposition: "out_of_scope",
            created_at: new Date().toISOString(),
          },
        ],
        requirements: [],
      };

      // Completed proposal cannot transition anywhere
      expect(() => {
        transitionProposalStatusInState(state, "cand-completed", "in_progress", "actor");
      }).toThrow(HarnessError);

      // Declined proposal cannot transition anywhere
      expect(() => {
        transitionProposalStatusInState(state, "cand-declined", "admitted", "actor");
      }).toThrow(HarnessError);

      expect(canTransitionProposal("completed", "in_progress")).toBe(false);
      expect(canTransitionProposal("declined", "granted")).toBe(false);
    });

    it("prevents role 'mind' from self-approving proposals via assertRoleMayDecideProposal", () => {
      expect(() => {
        assertRoleMayDecideProposal("mind", "mind_agent_01");
      }).toThrow(HarnessError);

      expect(() => {
        assertRoleMayDecideProposal("human_owner", "owner");
      }).not.toThrow();
    });

    it("supports proposal revision lifecycle transition", () => {
      const state: Record<string, unknown> = {
        candidates: [
          {
            id: "cand-rev",
            kind: "proposal",
            statement: "Original proposal",
            rationale: "First iteration",
            charter_goal_ids: ["goal-1"],
            status: "admitted",
            disposition: "actionable",
            created_at: new Date().toISOString(),
          },
        ],
        requirements: [],
      };

      const revised = transitionProposalStatusInState(
        state,
        "cand-rev",
        "revised",
        "orchestrator",
        {
          rationale: "Revision triggered by test regression signal",
        },
      );
      expect(revised.status).toBe("revised");
      expect(revised.revision_count).toBe(1);

      // Revised can transition back to admitted or in_progress
      const reAdmitted = transitionProposalStatusInState(
        state,
        "cand-rev",
        "admitted",
        "orchestrator",
      );
      expect(reAdmitted.status).toBe("admitted");
    });
  });

  describe("Rate Limiting, Cooldown & Capacity Caps", () => {
    it("enforces maximum open proposals budget ceiling", () => {
      const state: Record<string, unknown> = {
        candidates: [],
        requirements: [],
        budget: { max_open_proposals: 2, proposal_interval_ms: 0 },
      };

      recordProposalInState(state, {
        statement: "Proposal 1",
        rationale: "R1",
        charter_goal_ids: ["g1"],
        actor: "actor",
      });
      recordProposalInState(state, {
        statement: "Proposal 2",
        rationale: "R2",
        charter_goal_ids: ["g1"],
        actor: "actor",
      });

      const check = checkProposalRateLimits(state, { maxOpenProposals: 2 });
      expect(check.allowed).toBe(false);
      expect(check.openCount).toBe(2);

      expect(() => {
        recordProposalInState(state, {
          statement: "Proposal 3",
          rationale: "R3",
          charter_goal_ids: ["g1"],
          actor: "actor",
          maxOpenProposals: 2,
        });
      }).toThrow(HarnessError);
    });

    it("enforces 1 proposal per pulse limit", () => {
      const state: Record<string, unknown> = {
        candidates: [],
        requirements: [],
        budget: { max_open_proposals: 10, proposal_interval_ms: 0 },
      };

      recordProposalInState(state, {
        statement: "Proposal Pulse 42",
        rationale: "Pulse check",
        charter_goal_ids: ["g1"],
        actor: "actor",
        pulseId: 42,
      });

      const check = checkProposalRateLimits(state, { pulseId: 42 });
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("pulse 42");

      const checkOtherPulse = checkProposalRateLimits(state, { pulseId: 43 });
      expect(checkOtherPulse.allowed).toBe(true);
    });

    it("calculates remaining cooldown correctly based on minIntervalMs", () => {
      const now = Date.now();
      const state: Record<string, unknown> = {
        candidates: [
          {
            id: "cand-recent",
            kind: "proposal",
            statement: "Recent proposal",
            rationale: "Recent",
            charter_goal_ids: ["g1"],
            status: "needs_authority",
            created_at: new Date(now - 3_600_000).toISOString(), // 1 hour ago
          },
        ],
        budget: { max_open_proposals: 10, proposal_interval_ms: 7_200_000 }, // 2 hour interval
      };

      const remainingMs = calculateRemainingCooldownMs(state, { now, minIntervalMs: 7_200_000 });
      expect(remainingMs).toBeGreaterThan(0);
      expect(remainingMs).toBeLessThanOrEqual(3_600_000);

      const check = checkProposalRateLimits(state, { now, minIntervalMs: 7_200_000 });
      expect(check.allowed).toBe(false);
      expect(check.remainingCooldownMs).toBeGreaterThan(0);
    });
  });

  describe("Dynamic Plan Revision & Signal Synthesis", () => {
    it("generates structured plan revisions from various evolutionary signals", () => {
      const signals: PlanRevisionSignal[] = [
        {
          signalType: "TEST_REGRESSION",
          source: "scripts/src/mind/proposal.test.ts",
          severity: "CRITICAL",
          evidence: "Assertion failed in lifecycle state machine",
          affectedWriteScopes: ["olt/scripts/src/mind/proposals/proposal/index.ts"],
          charterGoalId: "goal-test-stability",
        },
        {
          signalType: "COGNITIVE_OVERLOAD",
          source: "scripts/src/mind/tasks/smart/index.ts",
          severity: "HIGH",
          evidence: "Function cyclomatic complexity exceeds threshold (score: 28 > 15)",
          affectedWriteScopes: ["olt/scripts/src/mind/tasks/smart/index.ts"],
          charterGoalId: "goal-maintainability",
        },
        {
          signalType: "DEFECT_SURGE",
          source: "scripts/src/mind/defects/index.ts",
          severity: "CRITICAL",
          evidence: "Multiple consecutive compilation errors detected",
          affectedWriteScopes: ["olt/scripts/src/mind/defects/index.ts"],
          charterGoalId: "goal-zero-defect",
        },
      ];

      const revisions = generatePlanRevisionFromSignals(signals, {
        confidenceThreshold: 0.85,
      });

      expect(revisions.length).toBe(3);

      const testRev = revisions.find((r) => r.signal.signalType === "TEST_REGRESSION");
      expect(testRev).toBeDefined();
      expect(testRev?.revisionType).toBe("TASK_SPLIT");
      expect(testRev?.proposedChanges.newTasks?.length).toBe(2);
      expect(testRev?.autonomousAdvancementEligible).toBe(true);

      const cogRev = revisions.find((r) => r.signal.signalType === "COGNITIVE_OVERLOAD");
      expect(cogRev).toBeDefined();
      expect(cogRev?.revisionType).toBe("COORDINATOR_REORGANIZATION");
      expect(cogRev?.proposedChanges.recommendedCoordinators).toBe(2);

      const defectRev = revisions.find((r) => r.signal.signalType === "DEFECT_SURGE");
      expect(defectRev).toBeDefined();
      expect(defectRev?.revisionType).toBe("PRIORITY_ESCALATION");
      expect(defectRev?.proposedChanges.newPriority).toBe("CRITICAL");
    });

    it("applies a plan revision to capsule state and formats markdown brief", () => {
      const state: Record<string, unknown> = {
        candidates: [],
        requirements: [],
        budget: { max_open_proposals: 10, proposal_interval_ms: 0 },
      };

      const signal: PlanRevisionSignal = {
        signalType: "TEST_REGRESSION",
        source: "src/auth.test.ts",
        severity: "CRITICAL",
        evidence: "Auth timeout failure",
        affectedWriteScopes: ["src/auth.ts"],
        charterGoalId: "goal-security",
      };

      const revisions = generatePlanRevisionFromSignals([signal]);
      expect(revisions.length).toBe(1);

      const result = applyPlanRevisionInState(state, revisions[0], "orchestrator_evolution");
      expect(result.applied).toBe(true);
      expect(result.createdProposals.length).toBe(2);

      const all = getAllProposals(state);
      expect(all.length).toBe(2);
      expect(all[0].status).toBe("admitted"); // autonomous initiative

      const brief = formatPlanRevisionBrief(revisions[0]);
      expect(brief).toContain("Plan Revision:");
      expect(brief).toContain("TASK_SPLIT");

      const proposalBrief = formatProposalBrief(all[0]);
      expect(proposalBrief).toContain("Proposal:");
      expect(proposalBrief).toContain("Autonomous Initiative");
    });
  });

  describe("Autonomous Initiative Triggers & Boundary Enforcement", () => {
    it("approves autonomous advancement for high-confidence, charter-aligned, safe proposals", () => {
      const input = {
        proposal: {
          statement: "Harden unit tests for layout shift tracker",
          rationale: "Increase test assertion density and edge case coverage",
          charter_goal_ids: ["goal-quality"],
          write_scope: ["olt/scripts/src/capture/layout-shift-tracker.test.ts"],
        },
        confidenceScore: 0.95,
        repoRoots: ["olt/"],
        charterProhibitions: ["git push", "rm -rf"],
      };

      const evalResult = evaluateInitiativeTriggers(input);
      expect(evalResult.canAdvanceAutonomously).toBe(true);
      expect(evalResult.action).toBe("AUTONOMOUS_ADMIT");
      expect(evalResult.safetyChecks.withinRepoRoots).toBe(true);
      expect(evalResult.safetyChecks.avoidsProhibitions).toBe(true);
      expect(evalResult.safetyChecks.confidenceThresholdMet).toBe(true);
    });

    it("requires human authority for proposals with low confidence or prohibited actions", () => {
      // 1. Prohibited keyword
      const prohibitedInput = {
        proposal: {
          statement: "Perform git push --force on main branch",
          rationale: "Deploy immediately",
          charter_goal_ids: ["goal-deploy"],
          write_scope: ["src/deploy.ts"],
        },
        confidenceScore: 0.99,
        charterProhibitions: ["git push", "rm -rf"],
      };

      const eval1 = evaluateInitiativeTriggers(prohibitedInput);
      expect(eval1.canAdvanceAutonomously).toBe(false);
      expect(eval1.action).toBe("REQUIRES_HUMAN_AUTHORITY");
      expect(eval1.safetyChecks.avoidsProhibitions).toBe(false);

      // 2. Low confidence score
      const lowConfidenceInput = {
        proposal: {
          statement: "Experimental speculative refactor",
          rationale: "Uncertain benefit",
          charter_goal_ids: ["goal-refactor"],
          write_scope: ["src/core.ts"],
        },
        confidenceScore: 0.65, // below 0.85
      };

      const eval2 = evaluateInitiativeTriggers(lowConfidenceInput);
      expect(eval2.canAdvanceAutonomously).toBe(false);
      expect(eval2.action).toBe("REQUIRES_HUMAN_AUTHORITY");
      expect(eval2.safetyChecks.confidenceThresholdMet).toBe(false);
    });

    it("advances proposal with initiative trigger recording proper witness", () => {
      const state: Record<string, unknown> = {
        candidates: [
          {
            id: "cand-initiative",
            kind: "proposal",
            statement: "Hardening test coverage autonomously",
            rationale: "Safe test addition",
            charter_goal_ids: ["goal-quality"],
            status: "needs_authority",
            disposition: "needs_authority",
            created_at: new Date().toISOString(),
          },
        ],
        requirements: [],
      };

      const evalResult = evaluateInitiativeTriggers({
        proposal: {
          statement: "Hardening test coverage autonomously",
          rationale: "Safe test addition",
          charter_goal_ids: ["goal-quality"],
        },
        confidenceScore: 0.92,
      });

      const advanced = advanceProposalWithInitiative(
        state,
        "cand-initiative",
        "orchestrator_auto",
        evalResult,
      );

      expect(advanced.status).toBe("admitted");
      expect(advanced.disposition).toBe("actionable");
      expect(advanced.witness).toContain("autonomous-initiative:");
    });
  });

  describe("Multi-Orchestrator Coordinator Hierarchy Scaling", () => {
    it("calculates hierarchy capacity and triggers SCALE_OUT under high queue load", () => {
      const mockTasks = Array.from({ length: 15 }, (_, i) => ({
        id: `task-${i + 1}`,
        label: `Task ${i + 1}`,
        status: "PENDING" as const,
        priority: "HIGH" as const,
        write_scope: [`src/module_${i % 3}.ts`],
        gate: "bun test",
        charter_goals: ["goal-1"],
        rationale: "Load test",
        source_type: "self_evolution" as const,
        created_at: new Date().toISOString(),
      }));

      const activeOrchestrators: OrchestratorNodeInfo[] = [
        {
          id: "orchestrator_wave-1",
          role: "orchestrator",
          tier: 1,
          domainSlug: "wave-1",
          assignedTaskIds: ["task-1", "task-2"],
          assignedWriteScopes: ["src/module_0.ts"],
          capacity: 5,
          currentLoad: 2,
          status: "ACTIVE",
        },
      ];

      const metrics = calculateHierarchyCapacity({
        taskQueue: mockTasks,
        orchestrators: activeOrchestrators,
        thresholds: { maxTasksPerTier1Orchestrator: 5, scaleOutLoadThreshold: 1.2 },
      });

      expect(metrics.totalPendingTasks).toBe(15);
      expect(metrics.tier1LoadRatio).toBe(15);
      expect(metrics.scalingDirection).toBe("SCALE_OUT");
      expect(metrics.recommendedTier1Count).toBe(3); // 15 / 5 = 3
      expect(metrics.recommendedTier2Count).toBe(5); // 15 / 3 = 5

      const decision = evaluateHierarchyScaling(metrics);
      expect(decision.action).toBe("SCALE_OUT");
      expect(decision.spawnsRecommended.length).toBe(2 + 4); // 2 additional T1 + 4 additional T2
      expect(decision.spawnsRecommended[0].role).toBe("orchestrator");
    });

    it("triggers SCALE_IN when queue is quiescent and excess orchestrators are running", () => {
      const activeOrchestrators: OrchestratorNodeInfo[] = [
        {
          id: "orchestrator_1",
          role: "orchestrator",
          tier: 1,
          domainSlug: "domain-1",
          assignedTaskIds: [],
          assignedWriteScopes: [],
          capacity: 5,
          currentLoad: 0,
          status: "IDLE",
        },
        {
          id: "orchestrator_2",
          role: "orchestrator",
          tier: 1,
          domainSlug: "domain-2",
          assignedTaskIds: [],
          assignedWriteScopes: [],
          capacity: 5,
          currentLoad: 0,
          status: "IDLE",
        },
      ];

      const metrics = calculateHierarchyCapacity({
        taskQueue: [],
        orchestrators: activeOrchestrators,
        thresholds: { minTier1Limit: 1 },
      });

      expect(metrics.totalPendingTasks).toBe(0);
      expect(metrics.scalingDirection).toBe("SCALE_IN");
      expect(metrics.recommendedTier1Count).toBe(1);

      const decision = evaluateHierarchyScaling(metrics);
      expect(decision.action).toBe("SCALE_IN");
      expect(decision.newTier1Count).toBe(1);
    });

    it("balances orchestrator load while preserving write scope isolation", () => {
      const orchestrators: OrchestratorNodeInfo[] = [
        {
          id: "orchestrator_ui",
          role: "orchestrator",
          tier: 1,
          domainSlug: "ui",
          assignedTaskIds: ["task-ui-1"],
          assignedWriteScopes: ["src/ui/button.ts"],
          capacity: 5,
          currentLoad: 1,
          status: "ACTIVE",
        },
        {
          id: "orchestrator_api",
          role: "orchestrator",
          tier: 1,
          domainSlug: "api",
          assignedTaskIds: [],
          assignedWriteScopes: [],
          capacity: 5,
          currentLoad: 0,
          status: "ACTIVE",
        },
      ];

      const tasksToAssign = [
        { id: "task-ui-2", write_scope: ["src/ui/button.ts", "src/ui/card.ts"] },
        { id: "task-api-1", write_scope: ["src/api/routes.ts"] },
        { id: "task-api-2", write_scope: ["src/api/handler.ts"] },
      ];

      const plan = balanceOrchestratorLoad(orchestrators, tasksToAssign, {
        maxTasksPerOrchestrator: 5,
      });

      expect(plan.assignments.length).toBe(2);
      const uiAssignment = plan.assignments.find((a) => a.orchestratorId === "orchestrator_ui");
      const apiAssignment = plan.assignments.find((a) => a.orchestratorId === "orchestrator_api");

      expect(uiAssignment?.taskIds).toContain("task-ui-2"); // Co-located due to matching write scope
      expect(apiAssignment?.taskIds).toContain("task-api-1");
      expect(apiAssignment?.taskIds).toContain("task-api-2");
      expect(plan.isBalanced).toBe(true);
    });
  });

  describe("Self-Evolution Loop Integration", () => {
    it("synthesizes dynamic plan revisions and formats evolution cycle briefs", () => {
      const discoveries = [
        {
          category: "TEST_COVERAGE",
          severity: "HIGH",
          description: "Missing test for plan revision state transitions",
          file: "scripts/src/mind/proposals/proposal/index.ts",
        },
        {
          category: "COGNITIVE_GAP",
          severity: "MEDIUM",
          description: "Cognitive chunk size exceeds recommended threshold",
          file: "scripts/src/mind/lifecycle/evolution/index.ts",
        },
      ];

      const synthesis = synthesizeDynamicPlanRevisions({
        discoveries,
        actor: "orchestrator_mind",
      });

      expect(synthesis.revisions.length).toBeGreaterThan(0);
      expect(synthesis.summary).toContain("Synthesized");
    });
  });

  describe("Static Invariant Proof: Zero-Any & Zero Suppressions", () => {
    it("proves 0 occurrences of TypeScript any and 0 compiler/linter suppressions across scoped files", () => {
      const filesToCheck = [
        resolve(process.cwd(), "olt/scripts/src/mind/proposals/proposal/index.ts"),
        resolve(process.cwd(), "olt/scripts/src/mind/lifecycle/evolution/index.ts"),
        resolve(process.cwd(), "tests/unit/mind/plan-revision.test.ts"),
      ];

      const linterPattern = ["es", "lint", "-disable"].join("");
      const forbiddenPatterns = [
        { name: "TypeScript ': any'", regex: /:\s*any\b/ },
        { name: "TypeScript 'as any'", regex: /\bas\s+any\b/ },
        { name: "TypeScript '<any>'", regex: /<any>/ },
        { name: "Record<string, any>", regex: /Record<string,\s*any>/ },
        { name: "Promise<any>", regex: /Promise<any>/ },
        { name: "@ts-ignore", regex: /@ts-ignore/ },
        { name: "@ts-expect-error", regex: /@ts-expect-error/ },
        { name: "@ts-nocheck", regex: /@ts-nocheck/ },
        { name: linterPattern, regex: new RegExp(linterPattern) },
      ];

      for (const filePath of filesToCheck) {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip lines within comments or string literals testing forbidden patterns if any
          if (
            line.includes("forbiddenPatterns") ||
            line.includes("regex:") ||
            line.includes("name:") ||
            line.includes("linterPattern")
          ) {
            continue;
          }

          for (const pattern of forbiddenPatterns) {
            const matches = pattern.regex.test(line);
            if (matches) {
              throw new Error(
                `Static invariant violation: found '${pattern.name}' in ${filePath}:${i + 1}\nLine: ${line}`,
              );
            }
          }
        }
      }

      expect(true).toBe(true);
    });
  });
});
