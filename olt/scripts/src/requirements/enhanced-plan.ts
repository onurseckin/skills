import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceClass, Evidenced } from "../core/contracts/evidence.ts";
import type { JsonObject } from "../core/contracts/json.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { renderEnhancedPlanMarkdown } from "./enhanced-plan-markdown.ts";

export const ENHANCED_PLAN_SCHEMA = "harness.enhanced-plan";
export const ENHANCED_PLAN_VERSION = 1;
export const PLANNING_DIRECTORY = "planning";
export const ENHANCED_PLAN_MARKDOWN_FILE = "enhanced-plan.md";
export const ENHANCED_PLAN_JSON_FILE = "enhanced-plan.json";

const REPORTED: EvidenceClass = "agent_reported";

export interface EnhancedPlanTodo extends JsonObject {
  id: string;
  text: string;
  evidence_class: EvidenceClass;
}

export interface EnhancedPlanDocument extends JsonObject {
  schema: string;
  version: number;
  run_id: string;
  prompt_sha256: string;
  derived_from: string;
  authoritative: boolean;
  recorded_at: string;
  actor: string;
  summary?: Evidenced<string>;
  observations: Evidenced<string>[];
  todos: EnhancedPlanTodo[];
  risks: Evidenced<string>[];
  open_questions: Evidenced<string>[];
  sources: Evidenced<string>[];
}

export interface EnhancedPlanInput {
  runId: string;
  promptSha256: string;
  actor: string;
  recordedAt: string;
  summary?: string | undefined;
  observations?: readonly string[] | undefined;
  todos?: readonly string[] | undefined;
  risks?: readonly string[] | undefined;
  openQuestions?: readonly string[] | undefined;
  sources?: readonly string[] | undefined;
}

export interface EnhancedPlanArtifacts extends JsonObject {
  markdown_path: string;
  json_path: string;
  markdown_sha256: string;
  json_sha256: string;
}

function reported(entries: readonly string[] | undefined): Evidenced<string>[] {
  return (entries ?? []).map((value) => ({ value, evidence_class: REPORTED }));
}

export function buildEnhancedPlan(input: EnhancedPlanInput): EnhancedPlanDocument {
  const observations = reported(input.observations);
  const risks = reported(input.risks);
  const openQuestions = reported(input.openQuestions);
  const sources = reported(input.sources);
  const todos = (input.todos ?? []).map((text, index) => ({
    id: `todo-${index + 1}`,
    text,
    evidence_class: REPORTED,
  }));
  if (
    input.summary === undefined &&
    observations.length === 0 &&
    todos.length === 0 &&
    risks.length === 0 &&
    openQuestions.length === 0
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "plan:enhance needs at least one of --summary, --observation, --todo, --risk or --open-question",
    );
  }
  return {
    schema: ENHANCED_PLAN_SCHEMA,
    version: ENHANCED_PLAN_VERSION,
    run_id: input.runId,
    prompt_sha256: input.promptSha256,
    derived_from: "prompt.md",
    authoritative: false,
    recorded_at: input.recordedAt,
    actor: input.actor,
    ...(input.summary === undefined
      ? {}
      : { summary: { value: input.summary, evidence_class: REPORTED } }),
    observations,
    todos,
    risks,
    open_questions: openQuestions,
    sources,
  };
}

export function writeEnhancedPlan(
  runRoot: string,
  document: EnhancedPlanDocument,
): EnhancedPlanArtifacts {
  mkdirSync(join(runRoot, PLANNING_DIRECTORY), { recursive: true, mode: 0o755 });
  const jsonRelative = join(PLANNING_DIRECTORY, ENHANCED_PLAN_JSON_FILE);
  const markdownRelative = join(PLANNING_DIRECTORY, ENHANCED_PLAN_MARKDOWN_FILE);
  const json = canonicalJsonBytes(document);
  const markdown = new TextEncoder().encode(renderEnhancedPlanMarkdown(document));
  atomicWriteBytes(join(runRoot, jsonRelative), json, { mode: 0o444 });
  atomicWriteBytes(join(runRoot, markdownRelative), markdown, { mode: 0o444 });
  return {
    markdown_path: markdownRelative,
    json_path: jsonRelative,
    markdown_sha256: sha256Bytes(markdown),
    json_sha256: sha256Bytes(json),
  };
}
