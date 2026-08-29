import type { FileRef } from "../graph/index.ts";
import {
  UNKNOWN,
  code,
  fence,
  joinOrNone,
  note,
  table,
  textOrUnknown,
} from "./markdown-primitives.ts";

export interface AttributedFileRef {
  file: FileRef;
  reportedBy: string;
}

function linesDelta(file: FileRef): string {
  if (file.additions === undefined && file.deletions === undefined) return UNKNOWN;
  return `+${file.additions ?? 0}/-${file.deletions ?? 0}`;
}

function gitObservationLines(file: FileRef): string[] {
  if (file.statusCode === undefined) return [];
  const hash =
    file.sha256 === null
      ? "no content to hash — the path carries no readable file at this status"
      : file.sha256 === undefined
        ? UNKNOWN
        : code(file.sha256);
  return [`- **Git status**: ${code(file.statusCode)}`, `- **Content hash**: ${hash}`];
}

export function fileProvenanceTable(entries: readonly AttributedFileRef[]): string[] {
  if (entries.length === 0) {
    return note("No agent reported a changed file and no branch observation recorded one.");
  }
  return table(
    ["Path", "Reported by", "Step", "Mode", "Lines changed", "+/-", "Evidence"],
    entries.map(({ file, reportedBy }) => [
      code(file.path),
      code(reportedBy),
      file.step === undefined ? UNKNOWN : String(file.step),
      textOrUnknown(file.mode ?? null),
      textOrUnknown(file.lines ?? null),
      linesDelta(file),
      textOrUnknown(file.evidence_class ?? null),
    ]),
  );
}

export function fileProvenanceDetails(entries: readonly AttributedFileRef[]): string[] {
  const withDetail = entries.filter(
    (entry) =>
      entry.file.rationale !== undefined ||
      entry.file.diff !== undefined ||
      entry.file.statusCode !== undefined,
  );
  if (withDetail.length === 0) return [];
  const lines: string[] = ["### Why each file changed, and its diff", ""];
  for (const { file, reportedBy } of withDetail) {
    lines.push(`#### \`${file.path}\` (${reportedBy})`, "");
    lines.push(`- **Why**: ${textOrUnknown(file.rationale ?? null)}`);
    if (file.requirementIds !== undefined && file.requirementIds.length > 0) {
      lines.push(`- **Requirements served**: ${joinOrNone(file.requirementIds.map(code))}`);
    }
    lines.push(...gitObservationLines(file));
    lines.push("");
    lines.push(
      ...(file.diff !== undefined
        ? fence(file.diff, "diff")
        : note("No diff could be read for this path against the run's baseline.")),
    );
    lines.push("");
  }
  return lines;
}
