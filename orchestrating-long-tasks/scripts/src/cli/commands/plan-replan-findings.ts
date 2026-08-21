import { HarnessError } from "../../errors/harness-error.ts";
import type { FindingDetail } from "../../workflow/scope-partitioner.ts";

export interface ReplanFindingsInput {
  readonly inline: string | undefined;
  readonly file: string | undefined;
  readonly readFile: (path: string) => string;
  readonly recorded: unknown;
  /** state.tasks — open findings a validator recorded via task:reject also become replan input. */
  readonly tasks?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function filePaths(record: Record<string, unknown>): string[] {
  if (Array.isArray(record.file_paths)) return record.file_paths.map(String);
  for (const key of ["file_path", "path"] as const) {
    const single = text(record[key]);
    if (single !== undefined) return [single];
  }
  return [];
}

export const UNREPORTED_REMEDIATION = "No remediation was reported with this finding.";

const SEVERITIES = ["critical", "important", "minor", "suggestion"] as const;

function severity(value: unknown, findingRef: string): FindingDetail["severity"] {
  const declared = SEVERITIES.find((entry) => entry === value);
  if (declared === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `finding ${findingRef} must declare severity ${SEVERITIES.join(", ")}`,
    );
  }
  return declared;
}

function findingFrom(value: unknown, index: number): FindingDetail {
  const record = isRecord(value) ? value : {};
  const observation = text(record.observation) ?? text(record.finding) ?? text(record.message);
  if (observation === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `finding ${index + 1} carries no observation; a finding must state what was observed`,
    );
  }
  const id = text(record.id) ?? `finding-critic-${index + 1}`;
  return {
    id,
    requirement_id: text(record.requirement_id),
    severity: severity(record.severity, id),
    file_paths: filePaths(record),
    observation,
    remediation: text(record.remediation) ?? UNREPORTED_REMEDIATION,
    // Every recorded finding schema (CompletionFinding, Finding) names this field `revalidation`;
    // that is the one name read here so a critic's or validator's recorded gate command is never
    // silently discarded in favor of a field the recording pipelines never write.
    revalidation_gate: text(record.revalidation),
  };
}

function parsePayload(content: string): FindingDetail[] {
  if (content.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "findings payload is not valid JSON; pass a JSON array of structured findings",
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.findings)
      ? parsed.findings
      : [parsed];
  return list.map(findingFrom);
}

// task:reject records its finding on the task itself (state.tasks[id].findings), not on
// state.completion_review — a validator never gets a chance to route through the critic's
// recording path at all. Without this, a validator's rejection is structurally invisible to
// plan:replan no matter how long it stays open.
function openTaskFindings(tasks: unknown): Record<string, unknown>[] {
  if (!isRecord(tasks)) return [];
  const findings: Record<string, unknown>[] = [];
  for (const task of Object.values(tasks)) {
    if (!isRecord(task) || !Array.isArray(task.findings)) continue;
    for (const finding of task.findings) {
      if (isRecord(finding) && finding.status === "open") findings.push(finding);
    }
  }
  return findings;
}

export function collectReplanFindings(input: ReplanFindingsInput): FindingDetail[] {
  let content = input.inline;
  if (!content && input.file) {
    try {
      content = input.readFile(input.file);
    } catch {
      throw new HarnessError("INVALID_ARGUMENT", `cannot read findings file: ${input.file}`);
    }
  }
  if (content) {
    const supplied = parsePayload(content);
    if (supplied.length > 0) return supplied;
  }

  const review = input.recorded;
  const recordedCritic = isRecord(review) && Array.isArray(review.findings) ? review.findings : [];
  const recordedTask = openTaskFindings(input.tasks);
  return [...recordedCritic, ...recordedTask].map(findingFrom);
}
