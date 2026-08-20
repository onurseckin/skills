import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BranchRecord } from "../contracts/branch.ts";
import { isBranchRecord } from "../contracts/branch.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import { isEvidenceClass, type EvidenceClass } from "../contracts/evidence.ts";
import { isJsonObject, type JsonObject, type JsonValue } from "../contracts/json.ts";
import type { TopologyRecord } from "../contracts/topology.ts";
import { readTopology } from "../contracts/topology.ts";
import {
  ENHANCED_PLAN_JSON_FILE,
  ENHANCED_PLAN_SCHEMA,
  PLANNING_DIRECTORY,
} from "../requirements/enhanced-plan.ts";
import type { WorkflowState } from "../workflow/types.ts";

export interface RequirementView {
  id: string;
  status: string | null;
  disposition: string | null;
  sourceLines: number[];
  instruction: string | null;
  subsystem: string | null;
  risk: string | null;
  priority: number | null;
  dependencies: string[];
  acceptance: string[];
  evidence: string[];
}

export interface DispositionView {
  line: number | null;
  kind: string | null;
  rationale: string | null;
  requirementIds: string[];
}

export interface GateView {
  id: string;
  scope: string | null;
  command: string | null;
  mandatory: boolean | null;
  requirementIds: string[];
}

/**
 * One command as the report needs it. Every field is separately optional because a projection copy
 * and a disk record can disagree about what they carry, and a field neither of them holds has to
 * reach the page as unknown rather than as a plausible default.
 */
export interface CommandView {
  id: string;
  argv: string[];
  actor: string | null;
  taskId: string | null;
  gateId: string | null;
  status: string | null;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  stdoutBytes: number | null;
  stderrBytes: number | null;
  /** `null` when the record kept no attempt list; the report will not claim a single attempt. */
  attempts: number | null;
}

/** One entry of the enhanced plan with the evidence label its writer recorded against it. */
export interface PlanEntryView {
  text: string;
  evidenceClass: EvidenceClass;
}

export interface EnhancedPlanView {
  derivedFrom: string | null;
  authoritative: boolean | null;
  recordedAt: string | null;
  actor: string | null;
  summary: PlanEntryView | null;
  observations: PlanEntryView[];
  todos: PlanEntryView[];
  risks: PlanEntryView[];
  openQuestions: PlanEntryView[];
  sources: PlanEntryView[];
}

/** What the critic wrote in its own words. It lives in the report file, never in the projection. */
export interface CriticReportView {
  decision: string | null;
  summary: string | null;
  createdAt: string | null;
}

function textOf(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringsOf(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function numbersOf(value: JsonValue | undefined): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number")
    : [];
}

function objectsOf(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function stateValue(state: Readonly<WorkflowState>, key: string): JsonValue | undefined {
  // The projection carries keys the WorkflowState contract does not declare, so the report reaches
  // them through the JSON shape the capsule actually persists.
  const record: Readonly<JsonObject> = state;
  return record[key];
}

/**
 * `state.requirements` is written by the plan projection as the whole requirement document, while
 * the workflow contract types it as the runtime array. Both shapes are read so a requirement is
 * never dropped on the way to the page.
 */
export function readRequirements(state: Readonly<WorkflowState>): RequirementView[] {
  const raw = stateValue(state, "requirements");
  const entries = Array.isArray(raw)
    ? raw.filter(isJsonObject)
    : isJsonObject(raw)
      ? objectsOf(raw.requirements)
      : [];
  return entries.flatMap((entry) => {
    const id = textOf(entry.id);
    if (id === null) return [];
    return [
      {
        id,
        status: textOf(entry.status),
        disposition: textOf(entry.disposition),
        sourceLines: numbersOf(entry.source_lines),
        instruction: textOf(entry.instruction),
        subsystem: textOf(entry.subsystem),
        risk: textOf(entry.risk),
        priority: typeof entry.priority === "number" ? entry.priority : null,
        dependencies: stringsOf(entry.dependencies),
        acceptance: objectsOf(entry.acceptance).flatMap((criterion) => {
          const text = textOf(criterion.criterion);
          return text === null ? [] : [text];
        }),
        evidence: stringsOf(entry.evidence),
      },
    ];
  });
}

export function readDispositions(state: Readonly<WorkflowState>): DispositionView[] {
  const raw = stateValue(state, "requirements");
  if (!isJsonObject(raw)) return [];
  return objectsOf(raw.dispositions).map((entry) => ({
    line: typeof entry.line === "number" ? entry.line : null,
    kind: textOf(entry.kind),
    rationale: textOf(entry.rationale),
    requirementIds: [
      ...(textOf(entry.requirement_id) === null ? [] : [textOf(entry.requirement_id)!]),
      ...stringsOf(entry.requirement_ids),
    ],
  }));
}

/** Gates live on the compiled graph; the run-scope completion gate is one of them. */
export function readGates(state: Readonly<WorkflowState>): GateView[] {
  const graph = stateValue(state, "graph");
  const fromGraph = isJsonObject(graph) ? objectsOf(graph.gates) : [];
  const fromState = objectsOf(stateValue(state, "gates"));
  const seen = new Set<string>();
  const gates: GateView[] = [];
  for (const entry of [...fromGraph, ...fromState]) {
    const id = textOf(entry.id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const command = entry.command;
    gates.push({
      id,
      scope: textOf(entry.scope),
      command: Array.isArray(command) ? stringsOf(command).join(" ") : textOf(command),
      mandatory: typeof entry.mandatory === "boolean" ? entry.mandatory : null,
      requirementIds: stringsOf(entry.requirement_ids),
    });
  }
  return gates;
}

/** A malformed branch entry is skipped rather than rendered as a half-known excursion. */
export function readBranches(state: Readonly<WorkflowState>): BranchRecord[] {
  const raw = stateValue(state, "branches");
  return Array.isArray(raw) ? raw.filter(isBranchRecord) : [];
}

/** The compiled plan's revision. It lives on the graph the projection wrote. */
export function readGraphRevision(state: Readonly<WorkflowState>): number | null {
  const direct = stateValue(state, "graph_revision");
  if (typeof direct === "number") return direct;
  const graph = stateValue(state, "graph");
  return isJsonObject(graph) && typeof graph.revision === "number" ? graph.revision : null;
}

export function readTopologyRecord(state: Readonly<WorkflowState>): TopologyRecord | null {
  return readTopology(state);
}

function commandView(id: string, record: JsonObject): CommandView {
  const logs = isJsonObject(record.logs) ? record.logs : undefined;
  const stdout = logs !== undefined && isJsonObject(logs.stdout) ? logs.stdout : undefined;
  const stderr = logs !== undefined && isJsonObject(logs.stderr) ? logs.stderr : undefined;
  return {
    id,
    argv: stringsOf(record.argv),
    actor: textOf(record.actor),
    taskId: textOf(record.task_id),
    gateId: textOf(record.gate_id),
    status: textOf(record.status),
    exitCode: typeof record.exit_code === "number" ? record.exit_code : null,
    startedAt: textOf(record.started_at),
    finishedAt: textOf(record.finished_at),
    stdoutBytes: typeof stdout?.bytes === "number" ? stdout.bytes : null,
    stderrBytes: typeof stderr?.bytes === "number" ? stderr.bytes : null,
    attempts: Array.isArray(record.attempts) ? record.attempts.length : null,
  };
}

/** Disk records win over the projection copy: they are the ones carrying attempt-level evidence. */
export function readCommands(
  state: Readonly<WorkflowState>,
  fromDisk: Record<string, CommandRecord>,
): CommandView[] {
  const merged = new Map<string, CommandView>();
  const projected = stateValue(state, "commands");
  if (isJsonObject(projected)) {
    for (const [id, entry] of Object.entries(projected)) {
      if (isJsonObject(entry)) merged.set(id, commandView(id, entry));
    }
  }
  for (const [id, record] of Object.entries(fromDisk)) merged.set(id, commandView(id, record));
  return [...merged.values()].sort((left, right) =>
    (left.startedAt ?? "").localeCompare(right.startedAt ?? ""),
  );
}

function parseJsonFile(path: string): JsonValue | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as JsonValue;
  } catch {
    // An artifact we cannot parse tells the report nothing, and nothing is what it will say.
    return null;
  }
}

function planEntry(value: JsonValue | undefined, prefix?: string): PlanEntryView | null {
  if (!isJsonObject(value)) return null;
  const text = textOf(value.value) ?? textOf(value.text);
  if (text === null) return null;
  return {
    text: prefix === undefined ? text : `${prefix}: ${text}`,
    // An entry whose writer recorded no evidence class carries none, not the class of its neighbour.
    evidenceClass: isEvidenceClass(value.evidence_class) ? value.evidence_class : "unknown",
  };
}

function planEntries(value: JsonValue | undefined, prefixKey?: string): PlanEntryView[] {
  return objectsOf(value).flatMap((entry) => {
    const prefix = prefixKey === undefined ? undefined : (textOf(entry[prefixKey]) ?? undefined);
    const view = planEntry(entry, prefix);
    return view === null ? [] : [view];
  });
}

/**
 * The enhanced plan document itself, not the digest entry state keeps. A file whose schema does not
 * match is ignored, and every entry inside it is read defensively: a half-written document loses the
 * entries nobody can read rather than putting `undefined` on the page.
 */
export function readEnhancedPlan(runRoot: string): EnhancedPlanView | null {
  const parsed = parseJsonFile(join(runRoot, PLANNING_DIRECTORY, ENHANCED_PLAN_JSON_FILE));
  if (!isJsonObject(parsed) || parsed.schema !== ENHANCED_PLAN_SCHEMA) return null;
  return {
    derivedFrom: textOf(parsed.derived_from),
    authoritative: typeof parsed.authoritative === "boolean" ? parsed.authoritative : null,
    recordedAt: textOf(parsed.recorded_at),
    actor: textOf(parsed.actor),
    summary: planEntry(parsed.summary),
    observations: planEntries(parsed.observations),
    todos: planEntries(parsed.todos, "id"),
    risks: planEntries(parsed.risks),
    openQuestions: planEntries(parsed.open_questions),
    sources: planEntries(parsed.sources),
  };
}

export function readCriticReport(runRoot: string): CriticReportView | null {
  const parsed = parseJsonFile(join(runRoot, "reports", "critic-review.json"));
  if (!isJsonObject(parsed)) return null;
  return {
    decision: textOf(parsed.decision),
    summary: textOf(parsed.summary),
    createdAt: textOf(parsed.created_at),
  };
}
