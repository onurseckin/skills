import { HarnessError } from "../../errors/harness-error.ts";
import type { FindingDetail } from "../../workflow/scope-partitioner.ts";

export interface ReplanFindingsInput {
  readonly inline: string | undefined;
  readonly file: string | undefined;
  readonly readFile: (path: string) => string;
  /** `state.completion_review`, used when the caller passed no findings of its own. */
  readonly recorded: unknown;
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

/** Marks the absence rather than prescribing a fix the reporter never proposed. */
export const UNREPORTED_REMEDIATION = "No remediation was reported with this finding.";

const SEVERITIES = ["critical", "important", "minor", "suggestion"] as const;

/** Severity ranks the repair wave, so a severity nobody declared cannot be filled in with the
 *  middle of the scale — the reporter has to say how bad it is. */
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

/**
 * `revalidation` is prose in the recorded critic payload ("Re-run full verification gate."), so only
 * the explicit `revalidation_gate` key is read as a command. Prose promoted to a gate would be
 * recorded as an executable proof that cannot run.
 */
function findingFrom(value: unknown, index: number): FindingDetail {
  const record = isRecord(value) ? value : {};
  // The observation is the whole substance of a finding. Standing in generic prose for a reporter
  // that said nothing would put words nobody wrote in front of the repair implementer.
  const observation = text(record.observation) ?? text(record.finding) ?? text(record.message);
  if (observation === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `finding ${index + 1} carries no observation; a finding must state what was observed`,
    );
  }
  const id = text(record.id) ?? `finding-critic-${index + 1}`;
  return {
    // Synthesised only as an address for an otherwise unidentified record, never as a claim.
    id,
    requirement_id: text(record.requirement_id),
    severity: severity(record.severity, id),
    file_paths: filePaths(record),
    observation,
    remediation: text(record.remediation) ?? UNREPORTED_REMEDIATION,
    revalidation_gate: text(record.revalidation_gate),
  };
}

function parsePayload(content: string): FindingDetail[] {
  if (content.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // An unparseable payload is a caller error. Wrapping it into one finding whose observation is
    // the raw text would turn a malformed argument into a defect claim with an invented severity.
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
  const recorded = isRecord(review) && Array.isArray(review.findings) ? review.findings : [];
  return recorded.map(findingFrom);
}
