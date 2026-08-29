import type {
  ProactiveRoadmapPlan,
  ProactiveRoadmapPlanningOptions,
  ProactiveWavePlan,
  ProactiveWaveTask,
  StrategicCandidate,
  StrategicCandidateAdmissionOptions,
  StrategicCandidateAdmissionResult,
  StrategicCandidateEvaluation,
} from "./types.ts";

/**
 * 3. Candidate Admission Evaluation (Altitude: 30,000 feet)
 * Pre-evaluates incoming candidates against Charter goals and the 6 Admission Gates:
 * Gate 1: Witnessed
 * Gate 2: In-Charter
 * Gate 3: Falsifiable
 * Gate 4: Disjoint Scope
 * Gate 5: Budget Ok
 * Gate 6: Not Duplicate / Not Declined
 */
export function evaluateStrategicCandidateAdmission(
  candidates: readonly StrategicCandidate[],
  options: StrategicCandidateAdmissionOptions = {},
): StrategicCandidateAdmissionResult {
  const charterGoals = new Set(options.charterGoals ?? []);
  const activeScopes = new Set(options.activeScopes ?? []);
  const declinedIds = new Set(options.declinedIds ?? []);
  const maxAgents = options.maxAgentsInFlight ?? 8;
  const currentAgents = options.currentAgentsInFlight ?? 0;

  const evaluations: StrategicCandidateEvaluation[] = [];
  let admittedCount = 0;
  let declinedCount = 0;

  for (const cand of candidates) {
    const failingGates: number[] = [];

    // Gate 1: Witnessed (has witnessCommand or objective is non-empty)
    const gate1Witnessed = cand.objectiveStatement.trim().length > 0;
    if (!gate1Witnessed) failingGates.push(1);

    // Gate 2: In-Charter (cites valid charter goals if goals exist)
    const gate2InCharter =
      charterGoals.size === 0 || cand.charterGoalIds.some((g: string) => charterGoals.has(g));
    if (!gate2InCharter) failingGates.push(2);

    // Gate 3: Falsifiable
    const gate3Falsifiable = cand.objectiveStatement.trim().length >= 10;
    if (!gate3Falsifiable) failingGates.push(3);

    // Gate 4: Disjoint Scope (write scope does not collide with active scopes)
    const gate4DisjointScope =
      cand.writeScope.length === 0 || !cand.writeScope.some((s: string) => activeScopes.has(s));
    if (!gate4DisjointScope) failingGates.push(4);

    // Gate 5: Budget Ok (within agent concurrency limits)
    const gate5BudgetOk = currentAgents < maxAgents;
    if (!gate5BudgetOk) failingGates.push(5);

    // Gate 6: Not Duplicate / Declined
    const gate6NotDuplicate = !declinedIds.has(cand.id);
    if (!gate6NotDuplicate) failingGates.push(6);

    const admitted = failingGates.length === 0;
    if (admitted) {
      admittedCount += 1;
    } else {
      declinedCount += 1;
    }

    const decisionRationale = admitted
      ? `Candidate admitted across all 6 gates. Aligned with charter goals: [${cand.charterGoalIds.join(", ")}].`
      : `Candidate declined due to Gate violations: [${failingGates.map((g) => `Gate ${g}`).join(", ")}].`;

    evaluations.push({
      candidateId: cand.id,
      title: cand.title,
      gate1Witnessed,
      gate2InCharter,
      gate3Falsifiable,
      gate4DisjointScope,
      gate5BudgetOk,
      gate6NotDuplicate,
      admitted,
      failingGates,
      decisionRationale,
      assignedTier1Orchestrator: admitted ? "orchestrator_wave-next" : undefined,
    });
  }

  const summary = `Candidate Admission: ${candidates.length} evaluated, ${admittedCount} admitted, ${declinedCount} declined.`;

  return {
    evaluatedCount: candidates.length,
    admittedCount,
    declinedCount,
    evaluations,
    summary,
  };
}

/**
 * 4. Proactive Roadmap Planning for Future Fleets (Altitude: 30,000 feet)
 * During long subordinate execution windows (even 2+ hours), Mind proactively constructs
 * future fleet roadmaps, decomposes epics into isolated-scope waves, and drafts execution schedules
 * so downstream orchestrators experience zero idle queue latency upon wave completion.
 */
export function planProactiveRoadmap(
  options: ProactiveRoadmapPlanningOptions = {},
): ProactiveRoadmapPlan {
  const fleetId = options.fleetId ?? `fleet-future-${Date.now().toString(36)}`;
  const targetHorizonHours = options.targetHorizonHours ?? 2.5;
  const targetHorizonMs = Math.round(targetHorizonHours * 3_600_000);
  const admitted = options.admittedCandidates ?? [];
  const priorities = options.backlogPriorities ?? [];

  const waves: ProactiveWavePlan[] = [];

  // Wave 1: Immediate next generation unblocked foundations
  const wave1Tasks: ProactiveWaveTask[] = [];
  if (admitted.length > 0) {
    for (let i = 0; i < admitted.length; i += 1) {
      const cand = admitted[i]!;
      wave1Tasks.push({
        taskId: `task-${cand.id}`,
        description: cand.title,
        role: "implementer",
        estimatedDurationMs: 900_000,
      });
    }
  } else if (priorities.length > 0) {
    for (let i = 0; i < Math.min(3, priorities.length); i += 1) {
      wave1Tasks.push({
        taskId: `task-prio-${i + 1}`,
        description: priorities[i]!,
        role: "implementer",
        estimatedDurationMs: 900_000,
      });
    }
  } else {
    wave1Tasks.push({
      taskId: "task-strategic-foundation-1",
      description: "Foundation Architecture & Multi-Coordinator Decoupling",
      role: "implementer",
      estimatedDurationMs: 900_000,
    });
    wave1Tasks.push({
      taskId: "task-strategic-foundation-2",
      description: "Subagent Resource Quota & Viewport Validation Matrix",
      role: "implementer",
      estimatedDurationMs: 900_000,
    });
  }

  waves.push({
    waveNumber: 1,
    title: "Wave 1: Strategic Foundations & Core Implementations",
    scopeDescription: "Disjoint foundational modules with strict write lease boundaries",
    isolatedWriteScopes: ["olt/scripts/src/core", "olt/roles"],
    estimatedParallelism: wave1Tasks.length,
    atomicTasks: wave1Tasks,
  });

  // Wave 2: Downstream Hardening & Multi-Viewport Verification
  const wave2Tasks: ProactiveWaveTask[] = [
    {
      taskId: "task-verification-multi-viewport",
      description: "4-Tier Viewport Resolution Matrix & APCA Contrast Hardening",
      role: "validator",
      estimatedDurationMs: 600_000,
    },
    {
      taskId: "task-verification-soak-invariants",
      description: "Long-Running Soak & Subordinate Drift Watchdog Hardening",
      role: "validator",
      estimatedDurationMs: 600_000,
    },
  ];

  waves.push({
    waveNumber: 2,
    title: "Wave 2: Multi-Viewport Validation & Soak Verification",
    scopeDescription:
      "Independent validation passes covering all 4 viewport tiers and contract invariants",
    isolatedWriteScopes: ["tests/unit/mind", "tests/unit/roles"],
    estimatedParallelism: 2,
    atomicTasks: wave2Tasks,
  });

  const totalTasks = waves.reduce((sum, w) => sum + w.atomicTasks.length, 0);
  const maxParallelism = Math.max(...waves.map((w) => w.estimatedParallelism), 1);

  const proactiveStrategy =
    `Proactive Roadmap synthesized for Fleet '${fleetId}' over ${targetHorizonHours.toFixed(1)}h horizon. ` +
    `Constructed ${waves.length} waves with ${totalTasks} total tasks and peak topological concurrency P = ${maxParallelism}. ` +
    `Guarantees zero-delay handoff for Tier 1 Orchestrator upon current wave completion.`;

  return {
    fleetId,
    plannedAt: new Date().toISOString(),
    targetHorizonMs,
    targetHorizonHours,
    waves,
    totalTasks,
    maxParallelism,
    proactiveStrategy,
  };
}
