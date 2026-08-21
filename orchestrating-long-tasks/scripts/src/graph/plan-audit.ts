import type { EvidenceClass } from "../contracts/evidence.ts";
import type { JsonObject } from "../contracts/json.ts";
import { looksWholeSuite } from "./gate-breadth.ts";
import { latestGateProof } from "./gate-proof.ts";
import {
  analyzeScopeIndependence,
  checkScopeOverlap,
  normalizeScopePath,
} from "./scope-analyzer.ts";
import { expandWriteScope } from "./scope-expansion.ts";

export const AUDIT_INVARIANT_IDS = [
  "A1-granularity",
  "A2-parallelism",
  "A3-gate-discrimination",
  "A4-false-barrier",
  "A5-straggler",
  "A6-whole-suite-gate",
] as const;

export type AuditInvariantId = (typeof AUDIT_INVARIANT_IDS)[number];

const AUDIT_INVARIANT_ID_SET = new Set<string>(AUDIT_INVARIANT_IDS);

export function isAuditInvariantId(value: string): value is AuditInvariantId {
  return AUDIT_INVARIANT_ID_SET.has(value);
}

export type AuditSeverity = "blocking" | "advisory";

export interface AuditFinding extends JsonObject {
  invariant: AuditInvariantId;
  severity: AuditSeverity;
  message: string;
  task_ids: string[];
  evidence_class: EvidenceClass;
}

export interface AuditNotEvaluated extends JsonObject {
  invariant: AuditInvariantId;
  reason: string;
}

export interface PlanAuditResult {
  findings: AuditFinding[];
  not_evaluated: AuditNotEvaluated[];
}

export interface AuditTaskInput {
  taskId: string;
  writeScope: readonly string[];
  deps: readonly string[];
  gate: string;
  effort?: number | undefined;
}

function finding(
  invariant: AuditInvariantId,
  severity: AuditSeverity,
  message: string,
  taskIds: string[],
  evidenceClass: EvidenceClass,
): AuditFinding {
  return { invariant, severity, message, task_ids: taskIds, evidence_class: evidenceClass };
}

export function blockingFindings(result: PlanAuditResult): AuditFinding[] {
  return result.findings.filter((f) => f.severity === "blocking");
}

export function advisoryFindings(result: PlanAuditResult): AuditFinding[] {
  return result.findings.filter((f) => f.severity === "advisory");
}

function auditGranularity(repoRoot: string, tasks: readonly AuditTaskInput[]): AuditFinding[] {
  const perTask = tasks.map((t) => ({
    taskId: t.taskId,
    files: expandWriteScope(repoRoot, t.writeScope),
  }));
  const planFiles = new Set<string>();
  for (const t of perTask) for (const f of t.files) planFiles.add(f);
  if (planFiles.size < 5) return [];
  return perTask
    .filter((t) => t.files.length > 3)
    .map((t) => {
      const shown = t.files.slice(0, 6).join(", ");
      const more = t.files.length > 6 ? ", …" : "";
      return finding(
        "A1-granularity",
        "blocking",
        `task ${t.taskId}'s write scope expands to ${t.files.length} files (${shown}${more}) while the ` +
          `plan touches ${planFiles.size} files in total — split it or justify why one task owns that much.`,
        [t.taskId],
        "harness_observed",
      );
    });
}

function normalizeGateArgv(gate: string): string {
  return gate.trim().split(/\s+/u).filter(Boolean).join(" ");
}

function gateArgvTokens(gate: string): string[] {
  return gate.trim().split(/\s+/u).filter(Boolean);
}

function provenFalsifiable(
  runState: JsonObject,
  taskId: string,
  gate: string,
  writeScope: readonly string[],
): boolean {
  const proof = latestGateProof(runState, taskId, gateArgvTokens(gate));
  if (proof === undefined || !proof.falsifiable) return false;
  const currentScope = [...writeScope].map(normalizeScopePath).sort();
  const provedScope = [...proof.write_scope].map(normalizeScopePath).sort();
  return (
    currentScope.length === provedScope.length &&
    currentScope.every((path, index) => path === provedScope[index])
  );
}

function auditGateDiscrimination(
  tasks: readonly AuditTaskInput[],
  runState: JsonObject,
): AuditFinding[] {
  const normalized = tasks.map((t) => ({
    taskId: t.taskId,
    scope: t.writeScope.map(normalizeScopePath),
    gate: normalizeGateArgv(t.gate),
    rawGate: t.gate,
    rawScope: t.writeScope,
  }));
  const findings: AuditFinding[] = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i]!;
      const b = normalized[j]!;
      if (a.gate !== b.gate) continue;
      if (checkScopeOverlap(a.scope, b.scope).hasOverlap) continue;
      if (
        provenFalsifiable(runState, a.taskId, a.rawGate, a.rawScope) &&
        provenFalsifiable(runState, b.taskId, b.rawGate, b.rawScope)
      ) {
        continue;
      }
      findings.push(
        finding(
          "A3-gate-discrimination",
          "blocking",
          `tasks ${a.taskId} and ${b.taskId} have disjoint write scopes but the identical gate ` +
            `\`${a.rawGate}\` — it passes whether either task did its work or nothing at all.`,
          [a.taskId, b.taskId],
          "derived",
        ),
      );
    }
  }
  return findings;
}

function auditFalseBarriersAndStragglers(tasks: readonly AuditTaskInput[]): AuditFinding[] {
  const analysis = analyzeScopeIndependence(
    tasks.map((t) => ({ taskId: t.taskId, writeScope: t.writeScope, dependencies: t.deps })),
  );

  const falseBarriers = analysis.serializationWarnings.map((w) =>
    finding(
      "A4-false-barrier",
      "blocking",
      `${w.blockedTask} is serialized behind ${w.dependencyTask} for no scope reason: ${w.message}`,
      [w.blockedTask, w.dependencyTask],
      "derived",
    ),
  );

  const effortById = new Map<string, number>();
  for (const t of tasks) if (typeof t.effort === "number") effortById.set(t.taskId, t.effort);

  const stragglers: AuditFinding[] = [];
  for (const wave of analysis.concurrencyWaves) {
    const efforts = wave.tasks
      .map((id) => effortById.get(id))
      .filter((e): e is number => typeof e === "number");
    if (efforts.length < 2) continue;
    const med = median(efforts);
    if (med <= 0) continue;
    for (const taskId of wave.tasks) {
      const effort = effortById.get(taskId);
      if (effort === undefined || effort <= med * 3) continue;
      stragglers.push(
        finding(
          "A5-straggler",
          "advisory",
          `task ${taskId}'s effort estimate (${effort}) is more than 3x the median (${med}) of wave ` +
            `${wave.waveIndex}; the rest of the wave will idle waiting on it — split it or justify the estimate.`,
          [taskId],
          "derived",
        ),
      );
    }
  }

  return [...falseBarriers, ...stragglers];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function auditWholeSuiteGate(
  tasks: readonly AuditTaskInput[],
  runState: JsonObject,
): AuditFinding[] {
  return tasks
    .filter(
      (t) =>
        looksWholeSuite(t.gate) && !provenFalsifiable(runState, t.taskId, t.gate, t.writeScope),
    )
    .map((t) =>
      finding(
        "A6-whole-suite-gate",
        "blocking",
        `task ${t.taskId}'s gate \`${t.gate}\` runs the whole test suite; a task gate must prove its ` +
          `own scope. The run-wide suite belongs to --completion-gate, which runs once.`,
        [t.taskId],
        "derived",
      ),
    );
}

const A2_NOT_EVALUATED_REASON =
  "A2-parallelism needs a grounded count of distinct entities the prompt names. Deriving that " +
  "automatically would mean an NLP heuristic guessing a number nobody asked for, which this " +
  "harness refuses to fabricate; and no explicit, coordinator-declared entity count is collected " +
  "anywhere in this plan for it to compare against. Not evaluated.";

export function auditPlan(
  repoRoot: string,
  tasks: readonly AuditTaskInput[],
  runState: JsonObject = {},
): PlanAuditResult {
  const findings = [
    ...auditGranularity(repoRoot, tasks),
    ...auditGateDiscrimination(tasks, runState),
    ...auditFalseBarriersAndStragglers(tasks),
    ...auditWholeSuiteGate(tasks, runState),
  ];
  return {
    findings,
    not_evaluated: [{ invariant: "A2-parallelism", reason: A2_NOT_EVALUATED_REASON }],
  };
}
