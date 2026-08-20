import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent } from "../contracts/capsule.ts";
import type { JsonObject } from "../contracts/json.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";

const TRACE_FILE = "trace.md";

const HEADER = [
  "# Step trace",
  "",
  "Every recorded step of this run, in the order it happened. One row per event in",
  "`events.jsonl`; open that file when you need the payload behind a row.",
  "",
  "| Step | When | Actor | What happened | Subject | Outcome |",
  "| ---: | ---- | ----- | ------------- | ------- | ------- |",
  "",
].join("\n");

/** The identifiers a payload may name its subject with, most specific first. */
const SUBJECT_KEYS = [
  "task_id",
  "command_id",
  "branch_id",
  "packet_id",
  "gate_id",
  "agent_id",
  "finding_id",
  "id",
] as const;

/** The fields that say how a step turned out. Absent stays absent; nothing is inferred. */
const OUTCOME_KEYS = ["verdict", "status", "exit_code", "result", "round"] as const;

function cell(value: unknown): string | undefined {
  if (typeof value === "string") return value.length === 0 ? undefined : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function pick(payload: JsonObject, keys: readonly string[]): string {
  for (const key of keys) {
    const rendered = cell(payload[key]);
    if (rendered !== undefined) return escapeCell(rendered);
  }
  return "unknown";
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** One markdown row for one event. */
function traceRow(event: HarnessEvent): string {
  const payload =
    typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
      ? event.payload
      : {};
  return `| ${event.sequence} | ${event.timestamp} | ${escapeCell(event.actor)} | ${escapeCell(
    event.kind,
  )} | ${pick(payload, SUBJECT_KEYS)} | ${pick(payload, OUTCOME_KEYS)} |\n`;
}

/**
 * Rebuilds the whole trace. Derived from the chain, so it is always exactly reproducible; this is
 * the path that proves the appended file and a full replay agree.
 */
export function writeTrace(runRoot: string, events: readonly HarnessEvent[]): void {
  const body = events.map(traceRow).join("");
  atomicWriteBytes(join(runRoot, TRACE_FILE), new TextEncoder().encode(`${HEADER}${body}`));
}

/**
 * Adds the step that just happened. Appending keeps the cost of the trace constant per event, where
 * a rebuild would re-walk the chain on every commit.
 */
export function appendTraceStep(runRoot: string, event: HarnessEvent): void {
  appendFileSync(join(runRoot, TRACE_FILE), traceRow(event), "utf-8");
}
