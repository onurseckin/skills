import type { EvidenceClass, Evidenced } from "../../core/contracts/evidence.ts";

export const UNKNOWN = "unknown";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  if (ms < 60_000) return `${sec}s`;
  const min = (ms / 60_000).toFixed(1);
  return `${min}m (${sec}s)`;
}

export function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

export function code(value: string): string {
  const escaped = cell(value);
  const run = longestBacktickRun(escaped);
  if (run === 0) return `\`${escaped}\``;
  const delimiter = "`".repeat(run + 1);
  return `${delimiter} ${escaped} ${delimiter}`;
}

export function textOrUnknown(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim().length === 0 ? UNKNOWN : value;
}

export function numberOrUnknown(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : UNKNOWN;
}

export function evidenceLabel(evidenceClass: EvidenceClass, isEstimated?: boolean): string {
  return isEstimated === true ? `${evidenceClass}, estimate` : evidenceClass;
}

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

export function section(title: string, body: readonly string[]): string[] {
  const trimmed = [...body];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return [`## ${title}`, "", ...trimmed, ""];
}

export function note(text: string): string[] {
  return [`_${text}_`];
}

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

export function toolRefText(ref: { name: string; category?: string }): string {
  return ref.category === undefined ? ref.name : `${ref.name} (${ref.category})`;
}
