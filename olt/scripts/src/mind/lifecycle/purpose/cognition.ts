import type {
  ProactiveMindCognitionOptions,
  ProactiveMindCognitionResult,
  StrategicCandidateEvaluation,
} from "./types.ts";
import { MIND_STRATEGIC_ALTITUDE } from "./types.ts";
import { diagnoseMacroDag, groomBacklog } from "./strategic.ts";
import { evaluateStrategicCandidateAdmission, planProactiveRoadmap } from "./purpose.ts";

/**
 * 5. Full Proactive Mind Cognition Orchestrator (Altitude: 30,000 feet)
 * Actively utilizes subordinate execution windows (even 2+ hours) to run all 4 proactive activities:
 * - Macro DAG Diagnostics
 * - Backlog Grooming
 * - Candidate Admission Evaluation
 * - Proactive Roadmap Planning for Future Fleets
 */
export function executeProactiveMindCognition(
  options: ProactiveMindCognitionOptions = {},
): ProactiveMindCognitionResult {
  const windowMs = options.subordinateExecutionWindowMs ?? 7_200_000; // default 2 hours
  const windowHours = Number((windowMs / 3_600_000).toFixed(2));

  // 1. Macro-Level DAG Diagnostics
  const macroDag = diagnoseMacroDag({ nodes: options.nodes });

  // 2. Backlog Grooming
  const backlogGrooming = groomBacklog({
    rawItems: options.rawBacklog,
    charterGoals: options.charterGoals,
  });

  // 3. Candidate Admission
  const candidateAdmission = evaluateStrategicCandidateAdmission(options.candidates ?? [], {
    charterGoals: options.charterGoals,
    activeScopes: options.activeScopes,
    declinedIds: options.declinedIds,
  });

  // 4. Proactive Roadmap Planning
  const admittedCandidates = (options.candidates ?? []).filter((c) =>
    candidateAdmission.evaluations.some(
      (e: StrategicCandidateEvaluation) => e.candidateId === c.id && e.admitted,
    ),
  );

  const proactiveRoadmap = planProactiveRoadmap({
    fleetId: options.fleetId,
    targetHorizonHours: options.targetHorizonHours ?? Math.max(2.0, windowHours),
    admittedCandidates,
    backlogPriorities: backlogGrooming.strategicPriorities,
  });

  const strategicSummary =
    `[Mind 30,000ft Cognition] Utilized ${windowHours}h subordinate execution window: ` +
    `DAG diagnostics (P = ${macroDag.workSpanRatio}, ${macroDag.bottlenecks.length} bottlenecks), ` +
    `Backlog (${backlogGrooming.actionableCount} actionable items), ` +
    `Admissions (${candidateAdmission.admittedCount}/${candidateAdmission.evaluatedCount} admitted), ` +
    `Roadmap (${proactiveRoadmap.waves.length} waves, ${proactiveRoadmap.totalTasks} atomic tasks planned for next fleet).`;

  return {
    timestamp: new Date().toISOString(),
    altitude: MIND_STRATEGIC_ALTITUDE,
    subordinateExecutionWindowMs: windowMs,
    subordinateExecutionWindowHours: windowHours,
    macroDag,
    backlogGrooming,
    candidateAdmission,
    proactiveRoadmap,
    strategicSummary,
  };
}

/**
 * Formats a clean, high-density markdown brief of proactive mind cognition findings.
 */
export function formatStrategicCognitionBrief(result: ProactiveMindCognitionResult): string {
  const lines: string[] = [];

  lines.push(`### 🧠 Tier 0 Mind Strategic Cognition (Altitude: ${result.altitude})`);
  lines.push(
    `**Subordinate Execution Window**: ${result.subordinateExecutionWindowHours}h (${result.subordinateExecutionWindowMs}ms)`,
  );
  lines.push(`**Strategic Summary**: ${result.strategicSummary}`);
  lines.push("");

  lines.push("#### 📊 Macro DAG Diagnostics");
  lines.push(
    `- Total Nodes: ${result.macroDag.totalNodes} | Critical Span: ${result.macroDag.criticalPathLength} levels | Total Work: ${Math.round(result.macroDag.totalWorkMs / 1000)}s`,
  );
  lines.push(
    `- Topological Concurrency (P = W / S): **${result.macroDag.workSpanRatio}** (Recommended Concurrency: ${result.macroDag.concurrencyRecommendation})`,
  );
  if (result.macroDag.bottlenecks.length > 0) {
    lines.push(`- Identified Bottlenecks (${result.macroDag.bottlenecks.length}):`);
    for (const b of result.macroDag.bottlenecks.slice(0, 3)) {
      lines.push(`  * \`${b.taskId}\` [${b.type}]: ${b.description}`);
    }
  } else {
    lines.push("- Bottlenecks: None detected (optimal topological flow)");
  }
  lines.push("");

  lines.push("#### 📋 Backlog Grooming & Strategic Priorities");
  lines.push(`- ${result.backlogGrooming.groomingSummary}`);
  if (result.backlogGrooming.strategicPriorities.length > 0) {
    for (const p of result.backlogGrooming.strategicPriorities.slice(0, 3)) {
      lines.push(`  * ${p}`);
    }
  }
  lines.push("");

  lines.push("#### 🛡️ Candidate Admission Pre-Evaluation");
  lines.push(`- ${result.candidateAdmission.summary}`);
  for (const e of result.candidateAdmission.evaluations.slice(0, 3)) {
    lines.push(
      `  * \`${e.candidateId}\`: ${e.admitted ? "✅ ADMITTED" : "❌ DECLINED"} — ${e.decisionRationale}`,
    );
  }
  lines.push("");

  lines.push("#### 🚀 Proactive Roadmap Planning for Future Fleets");
  lines.push(`- ${result.proactiveRoadmap.proactiveStrategy}`);
  for (const wave of result.proactiveRoadmap.waves) {
    lines.push(
      `  * **${wave.title}** (${wave.atomicTasks.length} tasks, parallelism: ${wave.estimatedParallelism})`,
    );
    for (const t of wave.atomicTasks.slice(0, 2)) {
      lines.push(`    - \`${t.taskId}\` [${t.role}]: ${t.description}`);
    }
  }

  return lines.join("\n");
}

/**
 * Validates whether a given text or role definition satisfies the Tier 0 Mind strategic invariants:
 * - Strategic altitude: 30,000 feet
 * - Zero source code edits
 * - Zero unit test execution
 * - Zero critic jobs
 * - Proactive bandwidth utilization during long execution windows (2+ hours)
 */
export function verifyMindRoleStrategicInvariants(input: string | Record<string, unknown>): {
  readonly isValid: boolean;
  readonly altitudeCompliant: boolean;
  readonly zeroEditsCompliant: boolean;
  readonly zeroUnitTestsCompliant: boolean;
  readonly zeroCriticCompliant: boolean;
  readonly proactiveBandwidthCompliant: boolean;
  readonly violations: readonly string[];
} {
  const text = typeof input === "string" ? input : JSON.stringify(input);

  const lower = text.toLowerCase();
  const violations: string[] = [];

  const altitudeCompliant =
    lower.includes("30,000") || lower.includes("strategic brain") || lower.includes("tier 0");
  if (!altitudeCompliant) {
    violations.push("Missing explicit Strategic Brain / 30,000 feet altitude designation");
  }

  const zeroEditsCompliant =
    lower.includes("zero source code edits") ||
    lower.includes("zero source edits") ||
    lower.includes("never write, edit") ||
    lower.includes("write, edit, stage, revert, format or delete any repository file");
  if (!zeroEditsCompliant) {
    violations.push("Missing Zero Source Code Edits prohibition");
  }

  const zeroUnitTestsCompliant =
    lower.includes("zero unit test execution") ||
    lower.includes("zero unit tests") ||
    lower.includes("never run unit") ||
    lower.includes("unit test execution");
  if (!zeroUnitTestsCompliant) {
    violations.push("Missing Zero Unit Test Execution prohibition");
  }

  const zeroCriticCompliant =
    lower.includes("zero critic jobs") ||
    lower.includes("zero critic") ||
    lower.includes("critic jobs") ||
    lower.includes("critic passes");
  if (!zeroCriticCompliant) {
    violations.push("Missing Zero Critic Jobs prohibition");
  }

  const proactiveBandwidthCompliant =
    (lower.includes("bandwidth") ||
      lower.includes("subordinate execution window") ||
      lower.includes("2+ hours") ||
      lower.includes("proactive")) &&
    (lower.includes("dag") ||
      lower.includes("backlog") ||
      lower.includes("candidate") ||
      lower.includes("roadmap"));
  if (!proactiveBandwidthCompliant) {
    violations.push(
      "Missing proactive execution window bandwidth utilization specification (DAG diagnostics, backlog grooming, candidate admission, roadmap planning)",
    );
  }

  const isValid = violations.length === 0;

  return {
    isValid,
    altitudeCompliant,
    zeroEditsCompliant,
    zeroUnitTestsCompliant,
    zeroCriticCompliant,
    proactiveBandwidthCompliant,
    violations,
  };
}
