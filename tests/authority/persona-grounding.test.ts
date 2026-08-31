import { describe, expect, test } from "bun:test";
import {
  COGNITIVE_PILLARS,
  COGNITIVE_PILLARS_BY_CODE,
  COGNITIVE_PILLARS_COUNT,
  COGNITIVE_PILLARS_MAP,
  formatPillarsBrief,
  formatPillarsMarkdown,
  getAllCognitivePillars,
  getCognitivePillar,
  getPillarAuditQuestions,
  PILLAR_1_CLI_FIRST,
  PILLAR_2_VISUAL_TRUTH,
  PILLAR_3_THREAD_AUTHORITY,
  PILLAR_4_PERPETUAL_SELF_EVOLUTION,
  PILLAR_5_GRAPH_INTEROPERABILITY,
  PILLAR_6_FIRST_PRINCIPLES,
  PILLAR_7_INFINITE_CADENCE,
  type CognitivePillar,
  type CognitivePillarId,
  type SupervisoryRole,
} from "../../olt/scripts/src/authority/pillars.ts";
import {
  buildWatchdogAuditPrompt,
  createWatchdogTickReminder,
  evaluateReflexiveSelfAudit,
  formatReflexiveAuditEvaluation,
  generateWatchdogPersonaGrounding,
  getAllRoleBoundaryProfiles,
  getRoleBoundaryProfile,
  invalidatePersonaVerificationCaches,
  isSupervisoryRole,
  normalizeSupervisoryRole,
  SUPERVISORY_ROLE_BOUNDARIES,
  type ActiveLeaseInfo,
  type ReflexiveAuditContext,
  type SubordinateAgentInfo,
} from "../../olt/scripts/src/authority/persona/index.ts";

import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Cognitive Pillars Subsystem (authority/pillars.ts)", () => {
  test("defines exactly 7 cognitive pillars", () => {
    expect(COGNITIVE_PILLARS_COUNT).toBe(7);
    expect(COGNITIVE_PILLARS).toHaveLength(7);
    expect(getAllCognitivePillars()).toHaveLength(7);
  });

  test("each pillar has complete metadata, invariants, and supervisory implications", () => {
    for (let id = 1; id <= 7; id++) {
      const pillar = COGNITIVE_PILLARS_MAP[id as 1 | 2 | 3 | 4 | 5 | 6 | 7];
      expect(pillar).toBeDefined();
      expect(pillar.id).toBe(id as CognitivePillarId);
      expect(pillar.code.length).toBeGreaterThan(0);
      expect(pillar.title.length).toBeGreaterThan(0);
      expect(pillar.shortSummary.length).toBeGreaterThan(0);
      expect(pillar.description.length).toBeGreaterThan(0);
      expect(pillar.keyInvariants.length).toBeGreaterThanOrEqual(3);
      expect(pillar.selfAuditQuestion.length).toBeGreaterThan(0);
      expect(pillar.supervisoryImplications.mind.length).toBeGreaterThan(0);
      expect(pillar.supervisoryImplications.orchestrator.length).toBeGreaterThan(0);
      expect(pillar.supervisoryImplications.coordinator.length).toBeGreaterThan(0);
    }
  });

  test("pillar definitions match core architectural specifications", () => {
    // Pillar 1: CLI-First Token Leverage
    expect(PILLAR_1_CLI_FIRST.id).toBe(1);
    expect(PILLAR_1_CLI_FIRST.code).toBe("CLI_FIRST_TOKEN_LEVERAGE");
    expect(PILLAR_1_CLI_FIRST.title).toBe("CLI-First Token Leverage");

    // Pillar 2: Visual Truth & Radical Observability
    expect(PILLAR_2_VISUAL_TRUTH.id).toBe(2);
    expect(PILLAR_2_VISUAL_TRUTH.code).toBe("VISUAL_TRUTH_AND_RADICAL_OBSERVABILITY");
    expect(PILLAR_2_VISUAL_TRUTH.title).toBe("Visual Truth & Radical Observability");

    // Pillar 3: Thread Authority & Zero Main-Thread Spillover
    expect(PILLAR_3_THREAD_AUTHORITY.id).toBe(3);
    expect(PILLAR_3_THREAD_AUTHORITY.code).toBe("THREAD_AUTHORITY_AND_ZERO_MAIN_THREAD_SPILLOVER");
    expect(PILLAR_3_THREAD_AUTHORITY.title).toBe("Thread Authority & Zero Main-Thread Spillover");

    // Pillar 4: Perpetual Self-Evolution
    expect(PILLAR_4_PERPETUAL_SELF_EVOLUTION.id).toBe(4);
    expect(PILLAR_4_PERPETUAL_SELF_EVOLUTION.code).toBe("PERPETUAL_SELF_EVOLUTION");
    expect(PILLAR_4_PERPETUAL_SELF_EVOLUTION.title).toBe("Perpetual Self-Evolution");

    // Pillar 5: Graph Visualizer UI & External Interoperability
    expect(PILLAR_5_GRAPH_INTEROPERABILITY.id).toBe(5);
    expect(PILLAR_5_GRAPH_INTEROPERABILITY.code).toBe(
      "GRAPH_VISUALIZER_UI_AND_EXTERNAL_INTEROPERABILITY",
    );
    expect(PILLAR_5_GRAPH_INTEROPERABILITY.title).toBe(
      "Graph Visualizer UI & External Interoperability",
    );

    // Pillar 6: First-Principles Innovation & Radical Simplification
    expect(PILLAR_6_FIRST_PRINCIPLES.id).toBe(6);
    expect(PILLAR_6_FIRST_PRINCIPLES.code).toBe(
      "FIRST_PRINCIPLES_INNOVATION_AND_RADICAL_SIMPLIFICATION",
    );
    expect(PILLAR_6_FIRST_PRINCIPLES.title).toBe(
      "First-Principles Innovation & Radical Simplification",
    );

    // Pillar 7: Infinite Borderless Cadence & Topological Concurrency
    expect(PILLAR_7_INFINITE_CADENCE.id).toBe(7);
    expect(PILLAR_7_INFINITE_CADENCE.code).toBe(
      "INFINITE_BORDERLESS_CADENCE_AND_TOPOLOGICAL_CONCURRENCY",
    );
    expect(PILLAR_7_INFINITE_CADENCE.title).toBe(
      "Infinite Borderless Cadence & Topological Concurrency",
    );
  });

  test("getCognitivePillar resolves pillars by id, string number, code, title, and aliases", () => {
    expect(getCognitivePillar(1)).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("1")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("CLI_FIRST_TOKEN_LEVERAGE")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("cli_first_token_leverage")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("cli-first-token-leverage")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("pillar 1")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("pillar-1")).toBe(PILLAR_1_CLI_FIRST);

    expect(getCognitivePillar(2)).toBe(PILLAR_2_VISUAL_TRUTH);
    expect(getCognitivePillar("visual truth")).toBe(PILLAR_2_VISUAL_TRUTH);

    expect(getCognitivePillar(3)).toBe(PILLAR_3_THREAD_AUTHORITY);
    expect(getCognitivePillar("thread authority")).toBe(PILLAR_3_THREAD_AUTHORITY);

    expect(getCognitivePillar(4)).toBe(PILLAR_4_PERPETUAL_SELF_EVOLUTION);
    expect(getCognitivePillar(5)).toBe(PILLAR_5_GRAPH_INTEROPERABILITY);
    expect(getCognitivePillar(6)).toBe(PILLAR_6_FIRST_PRINCIPLES);
    expect(getCognitivePillar(7)).toBe(PILLAR_7_INFINITE_CADENCE);

    // Invalid queries
    expect(getCognitivePillar(0)).toBeUndefined();
    expect(getCognitivePillar(8)).toBeUndefined();
    expect(getCognitivePillar("invalid-pillar-identifier")).toBeUndefined();
  });

  test("getPillarAuditQuestions returns all 7 questions with role-specific mandates", () => {
    const generalQuestions = getPillarAuditQuestions();
    expect(generalQuestions).toHaveLength(7);
    expect(generalQuestions[0]).toContain("Am I leveraging high-density structured CLI tools");

    const mindQuestions = getPillarAuditQuestions("mind");
    expect(mindQuestions).toHaveLength(7);
    expect(mindQuestions[0]).toContain("[MIND mandate:");

    const orchestratorQuestions = getPillarAuditQuestions("orchestrator");
    expect(orchestratorQuestions).toHaveLength(7);
    expect(orchestratorQuestions[1]).toContain("[ORCHESTRATOR mandate:");

    const coordinatorQuestions = getPillarAuditQuestions("coordinator");
    expect(coordinatorQuestions).toHaveLength(7);
    expect(coordinatorQuestions[2]).toContain("[COORDINATOR mandate:");
  });

  test("formatPillarsMarkdown formats markdown documentation correctly", () => {
    const fullMarkdown = formatPillarsMarkdown();
    expect(fullMarkdown).toContain("### 🧠 The 7 Cognitive Pillars");
    expect(fullMarkdown).toContain("#### Pillar 1: CLI-First Token Leverage");
    expect(fullMarkdown).toContain(
      "#### Pillar 7: Infinite Borderless Cadence & Topological Concurrency",
    );
    expect(fullMarkdown).toContain("**Key Invariants:**");
    expect(fullMarkdown).toContain("**Reflexive Audit Question:**");

    const roleMarkdown = formatPillarsMarkdown({ supervisoryRole: "coordinator" });
    expect(roleMarkdown).toContain("**COORDINATOR Mandate:**");

    const compactMarkdown = formatPillarsMarkdown({ compact: true });
    expect(compactMarkdown).toContain("#### Pillar 1: CLI-First Token Leverage");
    expect(compactMarkdown).not.toContain("**Key Invariants:**");

    const brief = formatPillarsBrief();
    expect(brief).toContain("- **Pillar 1 (CLI-First Token Leverage)**:");
    expect(brief).toContain(
      "- **Pillar 7 (Infinite Borderless Cadence & Topological Concurrency)**:",
    );
  });
});

describe("Role Boundaries & Supervisory Profiles (authority/persona-grounding.ts)", () => {
  test("isSupervisoryRole accurately validates supervisory roles", () => {
    expect(isSupervisoryRole("mind")).toBe(true);
    expect(isSupervisoryRole("orchestrator")).toBe(true);
    expect(isSupervisoryRole("coordinator")).toBe(true);
    expect(isSupervisoryRole("MIND")).toBe(true);
    expect(isSupervisoryRole("Orchestrator")).toBe(true);
    expect(isSupervisoryRole("COORDINATOR")).toBe(true);

    expect(isSupervisoryRole("implementer")).toBe(false);
    expect(isSupervisoryRole("validator")).toBe(false);
    expect(isSupervisoryRole("repairer")).toBe(false);
    expect(isSupervisoryRole("completeness-critic")).toBe(false);
    expect(isSupervisoryRole("planner")).toBe(false);
    expect(isSupervisoryRole("unknown-role")).toBe(false);
  });

  test("normalizeSupervisoryRole normalizes role aliases and tier identifiers", () => {
    expect(normalizeSupervisoryRole("mind")).toBe("mind");
    expect(normalizeSupervisoryRole("human")).toBe("mind");
    expect(normalizeSupervisoryRole("tier 0")).toBe("mind");
    expect(normalizeSupervisoryRole("tier-0")).toBe("mind");

    expect(normalizeSupervisoryRole("orchestrator")).toBe("orchestrator");
    expect(normalizeSupervisoryRole("orch")).toBe("orchestrator");
    expect(normalizeSupervisoryRole("tier 1")).toBe("orchestrator");
    expect(normalizeSupervisoryRole("tier-1")).toBe("orchestrator");

    expect(normalizeSupervisoryRole("coordinator")).toBe("coordinator");
    expect(normalizeSupervisoryRole("coord")).toBe("coordinator");
    expect(normalizeSupervisoryRole("tier 2")).toBe("coordinator");
    expect(normalizeSupervisoryRole("tier-2")).toBe("coordinator");

    expect(normalizeSupervisoryRole("implementer")).toBeNull();
    expect(normalizeSupervisoryRole("validator")).toBeNull();
    expect(normalizeSupervisoryRole("")).toBeNull();
  });

  test("getRoleBoundaryProfile retrieves full profile for Mind, Orchestrator, and Coordinator", () => {
    // Mind
    const mindProfile = getRoleBoundaryProfile("mind");
    expect(mindProfile.role).toBe("mind");
    expect(mindProfile.tier).toBe(0);
    expect(mindProfile.tierName).toContain("Tier 0: Mind Lead");
    expect(mindProfile.permittedSpawns).toEqual(["orchestrator"]);
    expect(mindProfile.forbiddenActions).toContain("write_file");
    expect(mindProfile.forbiddenActions).toContain("claim_task");
    expect(mindProfile.forbiddenActions).toContain("spawn_tier_3_worker");
    expect(mindProfile.mandatoryCadence.heartbeatCadenceMs).toBe(180_000);
    expect(mindProfile.mandatoryCadence.supervisoryScheduleMinutes).toBe(5);
    expect(mindProfile.roleInvariants.length).toBeGreaterThanOrEqual(4);
    expect(mindProfile.reflexiveQuestions.length).toBeGreaterThanOrEqual(3);

    // Orchestrator
    const orchProfile = getRoleBoundaryProfile("orchestrator");
    expect(orchProfile.role).toBe("orchestrator");
    expect(orchProfile.tier).toBe(1);
    expect(orchProfile.tierName).toContain("Tier 1: Orchestrator Lead");
    expect(orchProfile.permittedSpawns).toEqual(["coordinator"]);
    expect(orchProfile.forbiddenActions).toContain("write_file");
    expect(orchProfile.forbiddenActions).toContain("spawn_tier_3_worker");
    expect(orchProfile.forbiddenActions).toContain("main_thread_finalization_spillover");

    // Coordinator
    const coordProfile = getRoleBoundaryProfile("coordinator");
    expect(coordProfile.role).toBe("coordinator");
    expect(coordProfile.tier).toBe(2);
    expect(coordProfile.tierName).toContain("Tier 2: Coordinator Lead");
    expect(coordProfile.permittedSpawns).toContain("implementer");
    expect(coordProfile.permittedSpawns).toContain("validator");
    expect(coordProfile.permittedSpawns).toContain("repairer");
    expect(coordProfile.forbiddenActions).toContain("write_file");
    expect(coordProfile.forbiddenActions).toContain("qualitative_pass_acceptance");
  });

  test("getRoleBoundaryProfile throws HarnessError for invalid roles", () => {
    expect(() => getRoleBoundaryProfile("implementer")).toThrow(HarnessError);
    expect(() => getRoleBoundaryProfile("invalid-role")).toThrow(HarnessError);
  });

  test("getAllRoleBoundaryProfiles returns profiles for all 3 supervisory roles", () => {
    const profiles = getAllRoleBoundaryProfiles();
    expect(profiles).toHaveLength(3);
    expect(profiles.map((p) => p.role)).toEqual(["mind", "orchestrator", "coordinator"]);
  });
});

describe("3-Minute Watchdog Persona Grounding Injection", () => {
  test("generates rich grounding injection with 7 pillars and role boundaries", () => {
    const injection = generateWatchdogPersonaGrounding({
      role: "coordinator",
      tickNumber: 1,
      runId: "run-test-123",
      pulseId: "pulse-456",
    });

    expect(injection.role).toBe("coordinator");
    expect(injection.tier).toBe(2);
    expect(injection.tickNumber).toBe(1);
    expect(injection.runId).toBe("run-test-123");
    expect(injection.pulseId).toBe("pulse-456");
    expect(injection.cadenceMs).toBe(180_000);
    expect(injection.pillars).toHaveLength(7);
    expect(injection.roleBoundaries.role).toBe("coordinator");
    expect(injection.reflexiveAuditQuestions).toHaveLength(7);

    // Formatted markdown assertions
    expect(injection.formattedMarkdown).toContain(
      "Autonomic Watchdog 3-Minute Persona Grounding [Tick #1]",
    );
    expect(injection.formattedMarkdown).toContain("`COORDINATOR` (Tier 2)");
    expect(injection.formattedMarkdown).toContain("`run-test-123`");
    expect(injection.formattedMarkdown).toContain("Invariant Boundaries & Absolute Confinement");
    expect(injection.formattedMarkdown).toContain("The 7 Cognitive Pillars Reflexive Grounding");
    expect(injection.formattedMarkdown).toContain("Pillar 1 (CLI-First Token Leverage)");
    expect(injection.formattedMarkdown).toContain(
      "Pillar 7 (Infinite Borderless Cadence & Topological Concurrency)",
    );
    expect(injection.formattedMarkdown).toContain("Role-Specific Reflexive Self-Audit Questions");

    // Compact prompt assertions
    expect(injection.compactPrompt).toContain("[WATCHDOG GROUNDING Tick #1]");
    expect(injection.compactPrompt).toContain("Role=COORDINATOR (Tier 2)");
  });

  test("calculates tick number automatically from elapsed time and cadence", () => {
    const startedAt = "2026-08-22T04:00:00.000Z";
    // 6 minutes later -> tick 3 (0-3m: tick 1, 3-6m: tick 2, 6m+: tick 3)
    const now = "2026-08-22T04:06:30.000Z";

    const injection = generateWatchdogPersonaGrounding({
      role: "orchestrator",
      startedAt,
      now,
      cadenceMs: 180_000,
    });

    expect(injection.tickNumber).toBe(3);
    expect(injection.elapsedMs).toBe(390_000);
    expect(injection.role).toBe("orchestrator");
    expect(injection.tier).toBe(1);
  });

  test("throws HarnessError when generating grounding for non-supervisory role", () => {
    expect(() =>
      generateWatchdogPersonaGrounding({
        role: "implementer",
      }),
    ).toThrow(HarnessError);
  });
});

describe("Reflexive Self-Audit & Behavioral Drift Evaluation Engine", () => {
  test("clean supervisory execution produces perfect compliance (pass=true, driftScore=0)", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      runId: "run-clean-1",
      activeLeases: [
        {
          taskId: "task-1",
          agentId: "agent-worker-1",
          writeScope: ["src/feature-a.ts"],
          heartbeatAgeMs: 30_000,
        },
        {
          taskId: "task-2",
          agentId: "agent-worker-2",
          writeScope: ["src/feature-b.ts"],
          heartbeatAgeMs: 45_000,
        },
      ],
      subordinates: [
        {
          agentId: "agent-worker-1",
          role: "implementer",
          tier: 3,
          status: "active",
          taskId: "task-1",
          lastHeartbeatAgeMs: 30_000,
        },
      ],
      recentActions: [
        { action: "plan:compile" },
        { action: "queue:wave", spawnedRole: "implementer" },
        { action: "gate:prove" },
      ],
      openFindingsCount: 0,
      failedGatesCount: 0,
      unprovenGatesCount: 0,
      queueReadyCount: 0,
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(true);
    expect(evaluation.driftScore).toBe(0);
    expect(evaluation.overallSeverity).toBe("none");
    expect(evaluation.findings).toHaveLength(0);
    expect(evaluation.invariantCompliance.zero_file_mutation).toBe(true);
    expect(evaluation.invariantCompliance.strict_tier_hierarchy).toBe(true);
    expect(evaluation.invariantCompliance.delegated_execution_only).toBe(true);
    expect(evaluation.invariantCompliance.write_scope_isolation).toBe(true);
    expect(evaluation.invariantCompliance.quantitative_proof_enforcement).toBe(true);
    expect(evaluation.subordinateHealth.healthy).toBe(true);
    expect(evaluation.subordinateHealth.activeCount).toBe(2);
    expect(evaluation.subordinateHealth.staleCount).toBe(0);
    expect(evaluation.subordinateHealth.conflictingScopeCount).toBe(0);
    expect(evaluation.markdownReport).toContain("🟢 PASS");
  });

  test("detects direct file mutation on supervisory thread as CRITICAL violation", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      fileModificationsOnSupervisoryThread: ["src/models/user.ts", "src/auth.ts"],
      recentActions: [{ action: "edit_file", targetFile: "src/models/user.ts" }],
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.overallSeverity).toBe("critical");
    expect(evaluation.invariantCompliance.zero_file_mutation).toBe(false);

    const finding = evaluation.findings.find(
      (f) => f.code === "SUPERVISORY_FILE_MUTATION_VIOLATION",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.type).toBe("role_invariants");
    expect(finding?.title).toContain("Direct File Mutation");
    expect(finding?.recommendation).toContain("Cease all direct file edits immediately");
    expect(evaluation.recommendedActions.length).toBeGreaterThan(0);
  });

  test("detects task self-implementation on supervisory thread as CRITICAL violation", () => {
    const context: ReflexiveAuditContext = {
      role: "mind",
      directExecutionAttempts: ["claim_task", "implement_task"],
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.overallSeverity).toBe("critical");
    expect(evaluation.invariantCompliance.delegated_execution_only).toBe(false);

    const finding = evaluation.findings.find(
      (f) => f.code === "TASK_SELF_IMPLEMENTATION_VIOLATION",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.description).toContain("MIND attempted self-implementation");
  });

  test("detects cross-tier spawning violation when Orchestrator spawns Tier 3 Implementer directly", () => {
    const context: ReflexiveAuditContext = {
      role: "orchestrator",
      crossTierSpawns: ["implementer", "validator"],
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.overallSeverity).toBe("critical");
    expect(evaluation.invariantCompliance.strict_tier_hierarchy).toBe(false);

    const finding = evaluation.findings.find((f) => f.code === "CROSS_TIER_SPAWNING_VIOLATION");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.description).toContain(
      "Permitted spawns are strictly limited to: [coordinator]",
    );
  });

  test("detects subordinate write scope collision as HIGH severity finding", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      activeLeases: [
        {
          taskId: "task-auth-backend",
          agentId: "agent-1",
          writeScope: ["src/auth/jwt.ts", "src/auth/session.ts"],
        },
        {
          taskId: "task-auth-middleware",
          agentId: "agent-2",
          writeScope: ["src/middleware/guard.ts", "src/auth/jwt.ts"],
        },
      ],
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.invariantCompliance.write_scope_isolation).toBe(false);
    expect(evaluation.subordinateHealth.conflictingScopeCount).toBe(1);
    expect(evaluation.subordinateHealth.healthy).toBe(false);

    const finding = evaluation.findings.find((f) => f.code === "SUBORDINATE_WRITE_SCOPE_CONFLICT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("high");
    expect(finding?.type).toBe("subordinate_fulfillment");
    expect(finding?.description).toContain("task-auth-backend vs task-auth-middleware");
  });

  test("detects stale subordinate leases exceeding watchdog timeout", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      activeLeases: [
        {
          taskId: "task-stale-worker",
          agentId: "agent-dead",
          heartbeatAgeMs: 400_000, // > 360,000ms timeout
          isStale: true,
        },
      ],
      subordinates: [
        {
          agentId: "agent-dead",
          role: "implementer",
          tier: 3,
          status: "stale",
          taskId: "task-stale-worker",
          lastHeartbeatAgeMs: 400_000,
        },
      ],
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.subordinateHealth.staleCount).toBe(1);
    expect(evaluation.subordinateHealth.healthy).toBe(false);

    const finding = evaluation.findings.find((f) => f.code === "STALE_SUBORDINATE_HEARTBEAT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
    expect(finding?.type).toBe("subordinate_fulfillment");
  });

  test("detects complacency and rubber-stamping drift when qualitative passes are accepted", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      validatorReviewsAcceptedWithoutProof: 3,
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.invariantCompliance.quantitative_proof_enforcement).toBe(false);

    const finding = evaluation.findings.find((f) => f.code === "COMPLACENCY_RUBBER_STAMPING_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("high");
    expect(finding?.type).toBe("behavioral_drift");
    expect(finding?.recommendation).toContain("coordinator:pushback");
  });

  test("detects idling/stalling drift when queue has ready tasks but zero active workers", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      queueReadyCount: 4,
      queueBlockedCount: 0,
      activeLeases: [],
      subordinates: [],
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.invariantCompliance.active_wave_progression).toBe(false);

    const finding = evaluation.findings.find((f) => f.code === "IDLING_STALLING_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
    expect(finding?.type).toBe("behavioral_drift");
    expect(finding?.description).toContain(
      "Execution queue has 4 ready task(s) available, but 0 active subordinate workers",
    );
  });

  test("detects premature completion drift when attempting completion with blockers", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      attemptedPrematureCompletion: true,
      openFindingsCount: 2,
      failedGatesCount: 1,
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.overallSeverity).toBe("critical");
    expect(evaluation.invariantCompliance.no_premature_completion).toBe(false);

    const finding = evaluation.findings.find((f) => f.code === "PREMATURE_COMPLETION_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.type).toBe("behavioral_drift");
  });

  test("detects context bloat drift when excessive raw source reads occur", () => {
    const context: ReflexiveAuditContext = {
      role: "orchestrator",
      rawSourceFileReadsCount: 15,
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    const finding = evaluation.findings.find((f) => f.code === "CONTEXT_BLOAT_DRIFT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("low");
    expect(finding?.type).toBe("behavioral_drift");
  });

  test("evaluates multiple concurrent drift findings and accumulates weighted drift score", () => {
    const context: ReflexiveAuditContext = {
      role: "coordinator",
      fileModificationsOnSupervisoryThread: ["src/hack.ts"], // Critical = 1.0
      validatorReviewsAcceptedWithoutProof: 1, // High = 0.5
      queueReadyCount: 2, // Medium = 0.25 (idling)
    };

    const evaluation = evaluateReflexiveSelfAudit(context);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.overallSeverity).toBe("critical");
    expect(evaluation.driftScore).toBe(1.0); // capped at 1.0
    expect(evaluation.findings.length).toBeGreaterThanOrEqual(3);
    expect(evaluation.markdownReport).toContain("🔴 CRITICAL DRIFT");
  });
});

describe("Watchdog Audit Prompts and Tick Reminders", () => {
  test("buildWatchdogAuditPrompt generates complete grounding prompt", () => {
    const prompt = buildWatchdogAuditPrompt("mind", {
      tickNumber: 5,
      runId: "run-mind-pulse-1",
    });

    expect(prompt).toContain("Autonomic Watchdog 3-Minute Persona Grounding [Tick #5]");
    expect(prompt).toContain("`MIND` (Tier 0)");
    expect(prompt).toContain("The 7 Cognitive Pillars Reflexive Grounding");
  });

  test("formatReflexiveAuditEvaluation outputs formatted markdown", () => {
    const evaluation = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      queueReadyCount: 3,
    });

    const report = formatReflexiveAuditEvaluation(evaluation);
    expect(report).toContain("### 🛡️ Supervisory Reflexive Self-Audit Report: `ORCHESTRATOR`");
    expect(report).toContain("Invariant Compliance Matrix");
  });

  test("createWatchdogTickReminder combines grounding and reflexive audit evaluation", () => {
    const reminder = createWatchdogTickReminder("coordinator", 2, {
      role: "coordinator",
      queueReadyCount: 1,
    });

    expect(reminder).toContain("Autonomic Watchdog 3-Minute Persona Grounding [Tick #2]");
    expect(reminder).toContain("---");
    expect(reminder).toContain("Supervisory Reflexive Self-Audit Report: `COORDINATOR`");
  });

  test("covers edge cases: invalid role error, release spillover, unreviewed findings, and cache invalidation", () => {
    // 1. evaluateReflexiveSelfAudit with invalid role throws HarnessError
    expect(() =>
      evaluateReflexiveSelfAudit({ role: "invalid_supervisor" as unknown as SupervisoryRole }),
    ).toThrow(HarnessError);

    // 2. Main thread release spillover detection
    const releaseSpilloverEval = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      isMainThreadExecution: true,
      recentActions: [
        {
          timestamp: new Date().toISOString(),
          action: "git_commit",
        },
      ],
    });
    expect(releaseSpilloverEval.invariantCompliance.background_finalization_confinement).toBe(
      false,
    );
    expect(
      releaseSpilloverEval.findings.some(
        (f) => f.code === "MAIN_THREAD_RELEASE_SPILLOVER_VIOLATION",
      ),
    ).toBe(true);

    // 3. Accumulated unreviewed findings (> 5)
    const unreviewedFindingsEval = evaluateReflexiveSelfAudit({
      role: "coordinator",
      openFindingsCount: 8,
    });
    expect(
      unreviewedFindingsEval.findings.some((f) => f.code === "ACCUMULATED_UNREVIEWED_FINDINGS"),
    ).toBe(true);

    // 4. buildWatchdogAuditPrompt with invalid role throws HarnessError
    expect(() => buildWatchdogAuditPrompt("invalid_role")).toThrow(HarnessError);

    // 5. createWatchdogTickReminder with invalid role throws HarnessError
    expect(() => createWatchdogTickReminder("invalid_role", 1)).toThrow(HarnessError);

    // 6. invalidatePersonaVerificationCaches runs without errors
    expect(() => invalidatePersonaVerificationCaches()).not.toThrow();

    // 7. parseNowMs timestamp formats: number, Date, invalid string, undefined
    const groundingDate = generateWatchdogPersonaGrounding({
      role: "mind",
      now: new Date(),
      startedAt: 1000,
      pulseId: "pulse-xyz",
    });
    expect(groundingDate.pulseId).toBe("pulse-xyz");

    const groundingInvalidDate = generateWatchdogPersonaGrounding({
      role: "mind",
      now: "invalid-iso-date-string",
    });
    expect(groundingInvalidDate.tickNumber).toBe(1);

    // 8. evaluateReflexiveSelfAudit with >3 modified files, delete_file without targetFile, write_file, and repair_task
    const complexAudit = evaluateReflexiveSelfAudit({
      role: "mind",
      fileModificationsOnSupervisoryThread: ["a.ts", "b.ts", "c.ts", "d.ts"],
      recentActions: [
        { action: "write_file", targetFile: "e.ts" },
        { action: "delete_file" },
        { action: "repair_task" },
        { action: "unrelated_action" },
      ],
      activeLeases: [
        {
          taskId: "task-overdue",
          agentId: "agent-1",
          heartbeatAgeMs: 500_000,
        },
      ],
      subordinates: [
        {
          agentId: "agent-1",
          role: "implementer",
          tier: 3,
          status: "active",
          lastHeartbeatAgeMs: 500_000,
        },
        {
          agentId: "agent-2",
          role: "validator",
          tier: 3,
          status: "completed",
        },
      ],
      unprovenGatesCount: 2,
      failedGatesCount: 1,
      attemptedPrematureCompletion: true,
    });
    expect(complexAudit.passed).toBe(false);
    expect(complexAudit.invariantCompliance.zero_file_mutation).toBe(false);
    expect(complexAudit.invariantCompliance.delegated_execution_only).toBe(false);
    expect(complexAudit.markdownReport).toContain("...");

    // 9. Main thread git_push and sync_global actions
    const pushSyncAudit = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      isMainThreadExecution: true,
      recentActions: [{ action: "git_push" }, { action: "sync_global" }],
    });
    expect(pushSyncAudit.invariantCompliance.background_finalization_confinement).toBe(false);

    // 10. Low severity / mild drift where passed is true
    const lowDriftAudit = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      rawSourceFileReadsCount: 11, // low severity finding (weight 0.1, score 0.1 < 0.2 -> passed: true)
    });
    expect(lowDriftAudit.overallSeverity).toBe("low");
    expect(lowDriftAudit.passed).toBe(true);

    // 11. Medium severity drift (statusEmoji: 🟡 WARNING)
    const mediumDriftAudit = evaluateReflexiveSelfAudit({
      role: "coordinator",
      queueReadyCount: 2,
      activeLeases: [],
      subordinates: [],
    });
    expect(mediumDriftAudit.overallSeverity).toBe("medium");
    expect(mediumDriftAudit.passed).toBe(false);
    expect(mediumDriftAudit.markdownReport).toContain("🟡 WARNING");

    // 11b. High severity drift only
    const highDriftAudit = evaluateReflexiveSelfAudit({
      role: "coordinator",
      validatorReviewsAcceptedWithoutProof: 2,
    });
    expect(highDriftAudit.overallSeverity).toBe("high");
    expect(highDriftAudit.passed).toBe(false);

    // 12. createWatchdogTickReminder without context fallback
    const tickReminderDefault = createWatchdogTickReminder("orchestrator", 1);
    expect(tickReminderDefault).toContain(
      "Autonomic Watchdog 3-Minute Persona Grounding [Tick #1]",
    );

    // 13. Action variants in eval-invariants
    const actionVariantsAudit = evaluateReflexiveSelfAudit({
      role: "orchestrator",
      isMainThreadExecution: true,
      recentActions: [
        { action: "write_file" }, // undefined targetFile -> "unknown_file"
        { action: "delete_file", targetFile: "obsolete.ts" },
        { action: "implement_task" },
        { action: "repair_task" },
        { action: "spawn_subagent" }, // no spawnedRole -> returns false
        { action: "spawn_subagent", spawnedRole: "unauthorized_admin" },
        { action: "git_commit" },
      ],
    });
    expect(actionVariantsAudit.invariantCompliance.zero_file_mutation).toBe(false);
    expect(actionVariantsAudit.invariantCompliance.delegated_execution_only).toBe(false);
    expect(actionVariantsAudit.invariantCompliance.strict_tier_hierarchy).toBe(false);
    expect(actionVariantsAudit.invariantCompliance.background_finalization_confinement).toBe(false);
  });
});
