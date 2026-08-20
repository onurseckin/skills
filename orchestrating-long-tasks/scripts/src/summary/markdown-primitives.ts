import type { EvidenceClass, Evidenced } from "../contracts/evidence.ts";

/**
 * The one string a missing value may render as. Every section routes absence through here so a
 * reader can grep the report for what the run never learned.
 */
export const UNKNOWN = "unknown";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  if (ms < 60_000) return `${sec}s`;
  const min = (ms / 60_000).toFixed(1);
  return `${min}m (${sec}s)`;
}

/** A cell may not carry the pipe or newline that would silently reshape the table around it. */
export function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** The longest run of backticks inside the text, so a delimiter can be chosen that outlasts it. */
function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

/**
 * A span whose own backticks cannot end it early. A value carrying backticks — an argv with a
 * command substitution, a path, a prompt line quoting an identifier — keeps every character it had.
 */
export function code(value: string): string {
  const escaped = cell(value);
  const run = longestBacktickRun(escaped);
  if (run === 0) return `\`${escaped}\``;
  const delimiter = "`".repeat(run + 1);
  // A span starting or ending with a backtick needs the padding space CommonMark strips back out.
  return `${delimiter} ${escaped} ${delimiter}`;
}

export function textOrUnknown(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim().length === 0 ? UNKNOWN : value;
}

export function numberOrUnknown(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : UNKNOWN;
}

/** `derived` values that are estimates say so, because a derived measurement is not a guess. */
export function evidenceLabel(evidenceClass: EvidenceClass, isEstimated?: boolean): string {
  return isEstimated === true ? `${evidenceClass}, estimate` : evidenceClass;
}

/**
 * The only way an `Evidenced<T>` reaches the page: value and label travel together, and an absent
 * one renders as unknown with no label at all rather than borrowing a neighbour's evidence.
 */
export function evidencedText<T>(
  entry: Evidenced<T> | undefined,
  render: (value: T) => string = (value) => String(value),
): string {
  if (entry === undefined) return UNKNOWN;
  return `${render(entry.value)} (${evidenceLabel(entry.evidence_class, entry.is_estimated)})`;
}

export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const lines: string[] = [];
  lines.push(`| ${headers.map(cell).join(" | ")} |`);
  lines.push(`| ${headers.map(() => ":---").join(" | ")} |`);
  for (const row of rows) lines.push(`| ${row.map(cell).join(" | ")} |`);
  return lines;
}

/** A section that renders nothing still renders: the reader must see that there was nothing. */
export function section(title: string, body: readonly string[]): string[] {
  const trimmed = [...body];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return [`## ${title}`, "", ...trimmed, ""];
}

export function note(text: string): string[] {
  return [`_${text}_`];
}

/**
 * Quoted verbatim so no reader mistakes a rendered artifact for the bytes the capsule holds. The
 * barrier always outlasts the longest backtick run inside, so a prompt that itself quotes a fence —
 * of any width — cannot close the block early and spill its remainder into the report as markup.
 */
export function fence(content: string, language = ""): string[] {
  const barrier = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return [`${barrier}${language}`, ...content.replace(/\s+$/, "").split("\n"), barrier];
}

export function joinOrUnknown(values: readonly string[], separator = ", "): string {
  return values.length === 0 ? UNKNOWN : values.join(separator);
}

export function joinOrNone(values: readonly string[], separator = ", "): string {
  return values.length === 0 ? "none" : values.join(separator);
}

/**
 * A tool as its reporter named it, beside the generic category they filed it under. The name is an
 * open instance string, so a tool nobody categorised simply renders without one.
 */
export function toolRefText(ref: { name: string; category?: string }): string {
  return ref.category === undefined ? ref.name : `${ref.name} (${ref.category})`;
}
