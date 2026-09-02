import { describe, expect, it } from "bun:test";
import { evaluateReflexiveSelfAudit } from "../../olt/scripts/src/authority/persona/evaluator.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Supervisory Persona Reflexive Self-Audit Evaluator", () => {
  it("throws HarnessError on invalid or non-supervisory role", () => {
    expect(() => evaluateReflexiveSelfAudit({ role: "implementer" as any })).toThrow(HarnessError);
    expect(() => evaluateReflexiveSelfAudit({ role: "" as any })).toThrow(
      /not a valid supervisory role/,
    );
  });

  it("evaluates a fully compliant Mind supervisor persona (Tier 0)", () => {
    const evalResult = evaluateReflexiveSelfAudit({
      role: "mind",
      now: "2026-09-01T12:00:00.000Z",
      activeLeases: [],
      queueReadyCount: 0,
    });

    expect(evalResult.role).toBe("mind");
    expect(evalResult.tier).toBe(0);
    expect(evalResult.passed).toBe(true);
    expect(evalResult.driftScore).toBe(0);
    expect(evalResult.overallSeverity).toBe("none");
    expect(evalResult.findings).toHaveLength(0);
    expect(evalResult.recommendedActions).toHaveLength(0);
    expect(evalResult.subordinateHealth.healthy).toBe(true);
    expect(evalResult.invariantCompliance.zero_file_mutation).toBe(true);
    expect(evalResult.invariantCompliance.strict_tier_hierarchy).toBe(true);
    expect(evalResult.groundingSummary).toContain("MIND is fully grounded");
    expect(evalResult.markdownReport).toContain(
      "🛡️ Supervisory Reflexive Self-Audit Report: `MIND`",
    );
    expect(evalResult.markdownReport).toContain("🟢 PASS (Drift Score: `0.00` / 1.00)");
    expect(evalResult.markdownReport).toContain("Tier 0 (Tier 0: Mind Lead");
  });

  it("evaluates Orchestrator and Coordinator with normalized aliases and Date timestamp", () => {
    const orchResult = evaluateReflexiveSelfAudit({
      role: "orch",
      now: new Date("2026-09-01T12:30:00.000Z"),
    });
    expect(orchResult.role).toBe("orchestrator");
    expect(orchResult.tier).toBe(1);
    expect(orchResult.passed).toBe(true);

    const coordResult = evaluateReflexiveSelfAudit({
      role: "coord",
      now: 1725192000000,
    });
    expect(coordResult.role).toBe("coordinator");
    expect(coordResult.tier).toBe(2);
    expect(coordResult.passed).toBe(true);
  });

  it("detects complacency / rubber-stamping drift (Drift 3.1)", () => {
    const result = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      validatorReviewsAcceptedWithoutProof: 3,
    });

    expect(result.passed).toBe(false);
    expect(result.overallSeverity).toBe("high");
    expect(result.invariantCompliance.quantitative_proof_enforcement).toBe(false);
    const finding = result.findings.find((f) => f.code === "COMPLACENCY_RUBBER_STAMPING_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("high");
    expect(finding?.evidence?.acceptedWithoutProof).toBe(3);
    expect(result.recommendedActions.some((a) => a.includes("coordinator:pushback"))).toBe(true);
    expect(result.markdownReport).toContain("Complacent Validator Sign-Off Without Proof");
  });

  it("detects idling / stalling drift when tasks are ready and concurrency is idle (Drift 3.2)", () => {
    const result = evaluateReflexiveSelfAudit({
      role: "coordinator",
      queueReadyCount: 4,
      queueBlockedCount: 0,
      activeLeases: [],
    });

    expect(result.passed).toBe(false);
    expect(result.overallSeverity).toBe("medium");
    expect(result.invariantCompliance.active_wave_progression).toBe(false);
    const finding = result.findings.find((f) => f.code === "IDLING_STALLING_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
    expect(finding?.evidence?.readyCount).toBe(4);
    expect(result.recommendedActions.some((a) => a.includes("queue:wave"))).toBe(true);
  });

  it("detects premature completion attempts with active blockers (Drift 3.3)", () => {
    const blockedResult = evaluateReflexiveSelfAudit({
      role: "mind",
      attemptedPrematureCompletion: true,
      openFindingsCount: 2,
      failedGatesCount: 1,
    });

    expect(blockedResult.passed).toBe(false);
    expect(blockedResult.overallSeverity).toBe("critical");
    expect(blockedResult.invariantCompliance.no_premature_completion).toBe(false);
    const finding = blockedResult.findings.find((f) => f.code === "PREMATURE_COMPLETION_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(blockedResult.groundingSummary).toContain("CRITICAL behavioral drift");
    expect(blockedResult.markdownReport).toContain("🔴 CRITICAL DRIFT");

    // Attempted completion without blockers does NOT trigger drift
    const cleanResult = evaluateReflexiveSelfAudit({
      role: "mind",
      attemptedPrematureCompletion: true,
      openFindingsCount: 0,
      failedGatesCount: 0,
      unprovenGatesCount: 0,
      activeLeases: [],
    });
    expect(cleanResult.findings.some((f) => f.code === "PREMATURE_COMPLETION_DRIFT")).toBe(false);
  });

  it("detects context bloat drift and handles low severity passing threshold (Drift 3.4)", () => {
    const result = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      rawSourceFileReadsCount: 12,
    });

    const finding = result.findings.find((f) => f.code === "CONTEXT_BLOAT_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("low");
    expect(result.overallSeverity).toBe("low");
    expect(result.driftScore).toBeLessThan(0.2);
    // Low severity below 0.2 drift score still passes
    expect(result.passed).toBe(true);
    expect(result.markdownReport).toContain("Context Bloat via Excessive Raw Source Reads");
  });

  it("detects supervisory file modifications, cross-tier spawning, and direct task execution", () => {
    const result = evaluateReflexiveSelfAudit({
      role: "mind",
      fileModificationsOnSupervisoryThread: ["src/app.ts"],
      directExecutionAttempts: ["implement_task"],
      crossTierSpawns: ["implementer"],
      recentActions: [
        { action: "edit_file", targetFile: "index.ts" },
        { action: "claim_task" },
        { action: "spawn_subagent", spawnedRole: "coordinator" },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.invariantCompliance.zero_file_mutation).toBe(false);
    expect(result.invariantCompliance.delegated_execution_only).toBe(false);
    expect(result.invariantCompliance.strict_tier_hierarchy).toBe(false);
    expect(result.findings.some((f) => f.code === "SUPERVISORY_FILE_MUTATION_VIOLATION")).toBe(
      true,
    );
    expect(result.findings.some((f) => f.code === "TASK_SELF_IMPLEMENTATION_VIOLATION")).toBe(true);
    expect(result.findings.some((f) => f.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);
  });

  it("evaluates main-thread release spillover and unreviewed findings accumulation", () => {
    const result = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      isMainThreadExecution: true,
      openFindingsCount: 6,
      recentActions: [{ action: "git_commit" }],
    });

    expect(result.invariantCompliance.background_finalization_confinement).toBe(false);
    expect(result.findings.some((f) => f.code === "MAIN_THREAD_RELEASE_SPILLOVER_VIOLATION")).toBe(
      true,
    );
    expect(result.findings.some((f) => f.code === "ACCUMULATED_UNREVIEWED_FINDINGS")).toBe(true);
  });

  it("evaluates stale leases and overlapping write scopes via subordinate health", () => {
    const result = evaluateReflexiveSelfAudit({
      role: "coordinator",
      activeLeases: [
        {
          taskId: "task-1",
          agentId: "agent-1",
          role: "implementer",
          isStale: true,
          writeScope: ["src/fileA.ts", "src/shared.ts"],
        },
        {
          taskId: "task-2",
          agentId: "agent-2",
          role: "implementer",
          isStale: false,
          writeScope: ["src/fileB.ts", "src/shared.ts"],
        },
      ],
      subordinates: [
        {
          agentId: "agent-1",
          role: "implementer",
          status: "stale",
          currentTaskId: "task-1",
        },
        {
          agentId: "agent-3",
          role: "validator",
          status: "completed",
        },
      ],
    });

    expect(result.subordinateHealth.healthy).toBe(false);
    expect(result.subordinateHealth.staleCount).toBe(1);
    expect(result.subordinateHealth.completedCount).toBe(1);
    expect(result.subordinateHealth.conflictingScopeCount).toBe(1);
    expect(result.invariantCompliance.write_scope_isolation).toBe(false);
    expect(result.findings.some((f) => f.code === "STALE_SUBORDINATE_HEARTBEAT")).toBe(true);
    expect(result.findings.some((f) => f.code === "SUBORDINATE_WRITE_SCOPE_CONFLICT")).toBe(true);
    expect(result.markdownReport).toContain("Subordinate Health**: Attention Required");
  });
});
