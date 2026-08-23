import type { EvidenceClass } from "../core/contracts/evidence.ts";
import type { JsonObject } from "../core/contracts/json.ts";
import { promptLines } from "../requirements/prompt-lines.ts";
import { looksWholeSuite, namesATarget } from "./gate-breadth.ts";
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

function gateArgvTokens(gate: string): string[] {
  return gate.trim().split(/\s+/u).filter(Boolean);
}

interface GateSignature {
  executable: string;
  subcommand: readonly string[];
  targets: readonly string[];
}

function gateSignature(gate: string): GateSignature {
  const tokens = gateArgvTokens(gate);
  const executable = tokens[0] ?? "";
  const subcommand: string[] = [];
  const targets = new Set<string>();
  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) continue;
    if (namesATarget(token)) targets.add(token);
    else subcommand.push(token);
  }
  return { executable, subcommand, targets: [...targets].sort() };
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameGateSignature(gateA: string, gateB: string): boolean {
  const a = gateSignature(gateA);
  const b = gateSignature(gateB);
  return (
    a.executable === b.executable &&
    sameSequence(a.subcommand, b.subcommand) &&
    sameSequence(a.targets, b.targets)
  );
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
    rawGate: t.gate,
    rawScope: t.writeScope,
  }));
  const findings: AuditFinding[] = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i]!;
      const b = normalized[j]!;
      if (!sameGateSignature(a.rawGate, b.rawGate)) continue;
      if (checkScopeOverlap(a.scope, b.scope).hasOverlap) continue;
      if (
        provenFalsifiable(runState, a.taskId, a.rawGate, a.rawScope) &&
        provenFalsifiable(runState, b.taskId, b.rawGate, b.rawScope)
      ) {
        continue;
      }
      const gateDescription =
        a.rawGate === b.rawGate
          ? `the identical gate \`${a.rawGate}\``
          : `structurally identical gates \`${a.rawGate}\` and \`${b.rawGate}\` (same executable, ` +
            `subcommand, and targets — the difference proves nothing)`;
      findings.push(
        finding(
          "A3-gate-discrimination",
          "blocking",
          `tasks ${a.taskId} and ${b.taskId} have disjoint write scopes but ${gateDescription} — ` +
            `it passes whether either task did its work or nothing at all.`,
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

const A2_PROMPT_LINE_THRESHOLD = 10;
const A2_MIN_INDEPENDENT_ROOTS = 5;

const A2_NOT_EVALUATED_REASON =
  "A2-parallelism has no grounded way to count the prompt's true distinct entities without an NLP " +
  "heuristic guessing a number nobody asked for, which this harness refuses to fabricate. It does " +
  `compare the prompt's non-blank line count — a countable fact already computed for requirement ` +
  `binding, not a guess — against the plan's independent-root count, but only fires once that signal ` +
  `is unambiguous (>= ${A2_PROMPT_LINE_THRESHOLD} prompt lines against < ${A2_MIN_INDEPENDENT_ROOTS} ` +
  "independent roots). Below that threshold the signal is too weak to support a confident verdict " +
  "either way, so this plan is not evaluated.";

function auditParallelism(
  tasks: readonly AuditTaskInput[],
  prompt: string,
): { finding: AuditFinding | undefined; notEvaluated: boolean } {
  const promptLineCount = promptLines(prompt).filter((line) => line.trim().length > 0).length;
  const independentRoots = tasks.filter((t) => t.deps.length === 0).length;
  if (promptLineCount < A2_PROMPT_LINE_THRESHOLD || independentRoots >= A2_MIN_INDEPENDENT_ROOTS) {
    return { finding: undefined, notEvaluated: true };
  }
  const taskIds = tasks.map((t) => t.taskId);
  return {
    finding: finding(
      "A2-parallelism",
      "blocking",
      `the prompt carries ${promptLineCount} non-blank lines — a countable fact, not a guess — while ` +
        `the plan has only ${independentRoots} independent root${independentRoots === 1 ? "" : "s"} ` +
        `among ${taskIds.length} task${taskIds.length === 1 ? "" : "s"}. This line-count-vs-root-count ` +
        `proxy does not claim to know the prompt's true entity count; it only fires on compression ` +
        `this flagrant. Split the plan or justify why so few roots cover this much prompt.`,
      taskIds,
      "derived",
    ),
    notEvaluated: false,
  };
}

export function auditPlan(
  repoRoot: string,
  tasks: readonly AuditTaskInput[],
  runState: JsonObject = {},
  prompt = "",
): PlanAuditResult {
  const parallelism = auditParallelism(tasks, prompt);
  const findings = [
    ...auditGranularity(repoRoot, tasks),
    ...(parallelism.finding ? [parallelism.finding] : []),
    ...auditGateDiscrimination(tasks, runState),
    ...auditFalseBarriersAndStragglers(tasks),
    ...auditWholeSuiteGate(tasks, runState),
  ];
  return {
    findings,
    not_evaluated: parallelism.notEvaluated
      ? [{ invariant: "A2-parallelism", reason: A2_NOT_EVALUATED_REASON }]
      : [],
  };
}
