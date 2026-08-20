import type { FileRef } from "./types.ts";
import { UNKNOWN, code, fence, joinOrNone, note, table, textOrUnknown } from "./markdown-primitives.ts";

/**
 * One `FileRef` plus the id of whichever task or branch reported it. `FileRef` itself carries no
 * back-reference to its reporter — a path can only ever belong to the one report that named it —
 * so the caller (which already knows which report it is walking) supplies the id alongside.
 */
export interface AttributedFileRef {
  file: FileRef;
  reportedBy: string;
}

function linesDelta(file: FileRef): string {
  if (file.additions === undefined && file.deletions === undefined) return UNKNOWN;
  return `+${file.additions ?? 0}/-${file.deletions ?? 0}`;
}

/**
 * The overview table (B15.2): one row per file, across every task and branch that reported one.
 * `Lines changed` is the compact hunk-range summary (`"12-18,44"`), not the diff itself — the diff
 * lives in `fileProvenanceDetails` below, where it has room to be read rather than crammed into a
 * table cell.
 */
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

/**
 * Why each file changed, and the unified diff that proves it (B15.2). Only a file carrying a
 * rationale or a diff earns a block here — a bare path with neither has nothing this section adds
 * over the overview table above. Diffs are carried whole: B3 makes completeness, not size, the
 * export's constraint, and a diff trimmed here is exactly the intent a reader could no longer
 * reconstruct.
 */
export function fileProvenanceDetails(entries: readonly AttributedFileRef[]): string[] {
  const withDetail = entries.filter(
    (entry) => entry.file.rationale !== undefined || entry.file.diff !== undefined,
  );
  if (withDetail.length === 0) return [];
  const lines: string[] = ["### Why each file changed, and its diff", ""];
  for (const { file, reportedBy } of withDetail) {
    lines.push(`#### \`${file.path}\` (${reportedBy})`, "");
    lines.push(`- **Why**: ${textOrUnknown(file.rationale ?? null)}`);
    if (file.requirementIds !== undefined && file.requirementIds.length > 0) {
      lines.push(`- **Requirements served**: ${joinOrNone(file.requirementIds.map(code))}`);
    }
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
