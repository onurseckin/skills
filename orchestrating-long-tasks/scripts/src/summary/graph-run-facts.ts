import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentGrantRecord } from "../contracts/agents.ts";
import type { BranchRecord } from "../contracts/branch.ts";
import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { readTopology } from "../contracts/topology.ts";
import type { WorkflowState } from "../workflow/types.ts";
import type {
  RunCompletionFacts,
  RunEnhancedPlanFacts,
  RunFacts,
  RunIntegrityFacts,
  RunPromptFacts,
  RunReportFacts,
  RunRepositoryFacts,
  RunRequirementFacts,
} from "./types.ts";

export interface RunFactsInput {
  runId: string;
  state: Readonly<WorkflowState>;
  promptText: string;
  branches: readonly BranchRecord[];
  agents: readonly AgentGrantRecord[];
  agentLedgerIssue?: string | undefined;
  events?: readonly HarnessEvent[] | undefined;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
}

function objectsIn(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function stringsIn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function text(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function count(record: JsonObject, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A map keyed by digest, read for its values. An array is accepted for the same reason. */
function inspectionsIn(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isJsonObject);
  return isJsonObject(value) ? Object.values(value).filter(isJsonObject) : [];
}

function object(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

/** A capsule file read for its contents. An unreadable file leaves the field absent, not empty. */
function readCapsuleText(runRoot: string | undefined, relative: string): string | undefined {
  if (runRoot === undefined) return undefined;
  try {
    const contents = readFileSync(join(runRoot, relative), "utf-8");
    return contents.length > 0 ? contents : undefined;
  } catch {
    return undefined;
  }
}

function readCapsuleJson(runRoot: string | undefined, relative: string): JsonObject | undefined {
  const contents = readCapsuleText(runRoot, relative);
  if (contents === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(contents);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The prompt, whole. `prompt_bytes` from the manifest is the harness's own count of the file it
 * captured; the length recomputed here would only restate what was decoded, so the manifest wins
 * when it has one.
 */
function buildPrompt(input: RunFactsInput): RunPromptFacts {
  const manifest = input.manifest as unknown as JsonObject | undefined;
  const recordedBytes = manifest === undefined ? undefined : count(manifest, "prompt_bytes");
  return {
    text: input.promptText,
    bytes: recordedBytes ?? Buffer.byteLength(input.promptText, "utf-8"),
    ...(manifest !== undefined && text(manifest, "prompt_sha256") !== undefined
      ? { sha256: text(manifest, "prompt_sha256") }
      : {}),
    path: "prompt.md",
    evidence_class: "harness_observed",
  };
}

/**
 * The enhanced plan is only ever a claim: the harness wrote and hashed the bytes, but an agent
 * supplied every sentence in them. That is why the whole record is stamped `agent_reported` even
 * though the digests beside it are measurements.
 */
function buildEnhancedPlan(input: RunFactsInput): RunEnhancedPlanFacts | undefined {
  const planning = object((input.state as unknown as JsonObject).planning);
  const entry = planning === undefined ? undefined : object(planning.enhanced_plan);
  const document = readCapsuleJson(input.runRoot, join("planning", "enhanced-plan.json"));
  const markdown = readCapsuleText(input.runRoot, join("planning", "enhanced-plan.md"));
  if (entry === undefined && document === undefined && markdown === undefined) return undefined;
  return {
    ...(entry !== undefined && count(entry, "revision") !== undefined
      ? { revision: count(entry, "revision") }
      : {}),
    ...(entry !== undefined && text(entry, "recorded_at") !== undefined
      ? { recordedAt: text(entry, "recorded_at") }
      : {}),
    ...(entry !== undefined && text(entry, "actor") !== undefined
      ? { actor: text(entry, "actor") }
      : {}),
    ...(entry !== undefined && text(entry, "prompt_sha256") !== undefined
      ? { promptSha256: text(entry, "prompt_sha256") }
      : {}),
    ...(entry !== undefined && text(entry, "markdown_path") !== undefined
      ? { markdownPath: text(entry, "markdown_path") }
      : {}),
    ...(entry !== undefined && text(entry, "json_path") !== undefined
      ? { jsonPath: text(entry, "json_path") }
      : {}),
    ...(entry !== undefined && text(entry, "markdown_sha256") !== undefined
      ? { markdownSha256: text(entry, "markdown_sha256") }
      : {}),
    ...(entry !== undefined && text(entry, "json_sha256") !== undefined
      ? { jsonSha256: text(entry, "json_sha256") }
      : {}),
    ...(markdown !== undefined ? { markdown } : {}),
    ...(document !== undefined ? { document } : {}),
    evidence_class: "agent_reported",
  };
}

/**
 * `state.requirements` holds the compiled document, not a bare list: the requirements and the line
 * dispositions that produced them travel together, because a requirement without the prompt line it
 * came from cannot be traced back to anything.
 */
function buildRequirements(state: Readonly<WorkflowState>): RunRequirementFacts | undefined {
  const document = object((state as unknown as JsonObject).requirements);
  if (document === undefined) return undefined;
  const requirements = objectsIn(document.requirements);
  const dispositions = objectsIn(document.dispositions);
  if (requirements.length === 0 && dispositions.length === 0) return undefined;
  return {
    ...(text(document, "schema") !== undefined ? { schema: text(document, "schema") } : {}),
    ...(count(document, "version") !== undefined ? { version: count(document, "version") } : {}),
    ...(text(document, "prompt_sha256") !== undefined
      ? { promptSha256: text(document, "prompt_sha256") }
      : {}),
    requirements,
    dispositions,
    // Compiled from the prompt by the harness, which is a derivation, not an observation of work.
    evidence_class: "derived",
  };
}

function buildCompletion(state: Readonly<WorkflowState>): RunCompletionFacts | undefined {
  const raw = state as unknown as JsonObject;
  const facts: RunCompletionFacts = {
    ...(object(raw.completion_critic) !== undefined
      ? { critic: object(raw.completion_critic) }
      : {}),
    ...(objectsIn(raw.completion_critic_history).length > 0
      ? { criticHistory: objectsIn(raw.completion_critic_history) }
      : {}),
    ...(object(raw.completion_review) !== undefined
      ? { review: object(raw.completion_review) }
      : {}),
    ...(objectsIn(raw.completion_reviews).length > 0
      ? { reviews: objectsIn(raw.completion_reviews) }
      : {}),
    ...(objectsIn(raw.completion_remediations).length > 0
      ? { remediations: objectsIn(raw.completion_remediations) }
      : {}),
    ...(object(raw.completion_verification) !== undefined
      ? { verification: object(raw.completion_verification) }
      : {}),
    ...(object(raw.completion_result) !== undefined
      ? { result: object(raw.completion_result) }
      : {}),
    ...(object(raw.completion) !== undefined ? { evidence: object(raw.completion) } : {}),
  };
  return Object.keys(facts).length > 0 ? facts : undefined;
}

/**
 * The submission, review, probe and critic reports the harness wrote to `reports/`. They are the one
 * home of several facts — a validator's verdict summary among them — so an export without them
 * cannot show what a reviewer actually said. Bearer tokens are already stored as digests, so the
 * documents travel as written.
 */
function buildReports(runRoot: string | undefined): RunReportFacts[] | undefined {
  if (runRoot === undefined) return undefined;
  let names: string[];
  try {
    names = readdirSync(join(runRoot, "reports"))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return undefined;
  }
  const reports: RunReportFacts[] = [];
  for (const name of names) {
    const document = readCapsuleJson(runRoot, join("reports", name));
    if (document === undefined) continue;
    reports.push({ path: join("reports", name), document, evidence_class: "harness_observed" });
  }
  return reports.length > 0 ? reports : undefined;
}

/**
 * One event of the append-only chain. The chain is the only ordered record of what happened when,
 * so it travels whole apart from `projection`: that field is a full state snapshot taken at every
 * event, which would repeat the final state once per event and would carry each command's child
 * environment — the live ownership token included — into a file meant for a browser. The state it
 * snapshots is exported once, in full, everywhere else in this object.
 */
function redactedEvent(event: HarnessEvent): JsonObject {
  const { projection: _projection, ...rest } = event;
  return rest;
}

/** Which repository the run was bound to, and every reading the harness took of it. */
function buildRepository(state: Readonly<WorkflowState>): RunRepositoryFacts | undefined {
  const raw = state as unknown as JsonObject;
  const facts: RunRepositoryFacts = {
    ...(object(raw.baseline_repository_binding) !== undefined
      ? { baselineBinding: object(raw.baseline_repository_binding) }
      : {}),
    ...(object(raw.current_repository_binding) !== undefined
      ? { currentBinding: object(raw.current_repository_binding) }
      : {}),
    ...(text(raw, "baseline_repository_inspection_sha256") !== undefined
      ? { baselineInspectionSha256: text(raw, "baseline_repository_inspection_sha256") }
      : {}),
    ...(text(raw, "current_repository_inspection_sha256") !== undefined
      ? { currentInspectionSha256: text(raw, "current_repository_inspection_sha256") }
      : {}),
    // The inspections are stored under their own digests, so the values are the readings.
    ...(inspectionsIn(raw.repository_inspections).length > 0
      ? { inspections: inspectionsIn(raw.repository_inspections) }
      : {}),
    evidence_class: "harness_observed",
  };
  return Object.keys(facts).length > 1 ? facts : undefined;
}

/** Where the event chain stood when this export was taken. */
function buildIntegrity(state: Readonly<WorkflowState>): RunIntegrityFacts | undefined {
  const raw = state as unknown as JsonObject;
  const eventHead = raw.event_head;
  const facts: RunIntegrityFacts = {
    ...(text(raw, "schema") !== undefined ? { schema: text(raw, "schema") } : {}),
    ...(count(raw, "version") !== undefined ? { version: count(raw, "version") } : {}),
    ...(count(raw, "revision") !== undefined ? { revision: count(raw, "revision") } : {}),
    ...(count(raw, "event_sequence") !== undefined
      ? { eventSequence: count(raw, "event_sequence") }
      : {}),
    ...(typeof eventHead === "string" || eventHead === null ? { eventHead } : {}),
    ...(count(raw, "graph_revision") !== undefined
      ? { graphRevision: count(raw, "graph_revision") }
      : {}),
    evidence_class: "harness_observed",
  };
  return Object.keys(facts).length > 1 ? facts : undefined;
}

/** Gate definitions live on the compiled plan graph, which is where the gate nodes get their ids. */
function buildGates(state: Readonly<WorkflowState>): JsonObject[] | undefined {
  const graph = object((state as unknown as JsonObject).graph);
  const gates = graph === undefined ? [] : objectsIn(graph.gates);
  return gates.length > 0 ? gates : undefined;
}

/**
 * Everything the run recorded that belongs to no single node. Nothing here is computed from a name
 * or a shape: a fact the capsule does not hold is simply left out, so a reader can tell "the run
 * never recorded this" from "the exporter dropped it".
 */
export function buildRunFacts(input: RunFactsInput): RunFacts {
  const manifest = input.manifest as unknown as JsonObject | undefined;
  const taskOrder = stringsIn((input.state as unknown as JsonObject).task_order);
  const orphans = objectsIn((input.state as unknown as JsonObject).orphan_evidence);
  const dispositions = objectsIn(
    (input.state as unknown as JsonObject).orphan_evidence_dispositions,
  );
  const topology = readTopology(input.state);
  const enhancedPlan = buildEnhancedPlan(input);
  const requirements = buildRequirements(input.state);
  const completion = buildCompletion(input.state);
  const gates = buildGates(input.state);
  const reports = buildReports(input.runRoot);
  const raw = input.state as unknown as JsonObject;
  const planGraph = object(raw.graph);
  const planHistory = objectsIn(raw.plan_history);
  const planningTasks = objectsIn(raw.planning_tasks);
  const planningBuffer = objectsIn(raw.planning_buffer);
  const packets = object(raw.packets);
  const repository = buildRepository(input.state);
  const integrity = buildIntegrity(input.state);
  const events = (input.events ?? []).map(redactedEvent);

  return {
    runId: input.runId,
    ...(manifest !== undefined && text(manifest, "capsule_id") !== undefined
      ? { capsuleId: text(manifest, "capsule_id") }
      : {}),
    prompt: buildPrompt(input),
    ...(enhancedPlan !== undefined ? { enhancedPlan } : {}),
    ...(requirements !== undefined ? { requirements } : {}),
    ...(topology !== null ? { topology } : {}),
    ...(taskOrder.length > 0 ? { taskOrder } : {}),
    ...(gates !== undefined ? { gates } : {}),
    ...(input.branches.length > 0 ? { branches: [...input.branches] } : {}),
    ...(input.agents.length > 0 ? { agents: [...input.agents] } : {}),
    ...(input.agentLedgerIssue !== undefined ? { agentLedgerIssue: input.agentLedgerIssue } : {}),
    ...(reports !== undefined ? { reports } : {}),
    ...(planGraph !== undefined ? { planGraph } : {}),
    ...(planHistory.length > 0 ? { planHistory } : {}),
    ...(planningTasks.length > 0 ? { planningTasks } : {}),
    ...(planningBuffer.length > 0 ? { planningBuffer } : {}),
    ...(packets !== undefined ? { packets: Object.values(packets).filter(isJsonObject) } : {}),
    ...(repository !== undefined ? { repository } : {}),
    ...(integrity !== undefined ? { integrity } : {}),
    ...(events.length > 0 ? { events } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(completion !== undefined ? { completion } : {}),
    ...(orphans.length > 0 ? { orphanEvidence: orphans } : {}),
    ...(dispositions.length > 0 ? { orphanEvidenceDispositions: dispositions } : {}),
  };
}
