import { stripAnsi } from "./stream-parser.ts";
import type { SuiteLoadFailure } from "./types.ts";

export const UNHANDLED_ERROR_MARKER = "# Unhandled error between tests";
export const UNKNOWN_SUITE_FILE = "<unattributed test file>";

const SUITE_HEADER_PATTERN = /^([^\s:]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)):$/;
const FENCE_PATTERN = /^-{3,}$/;
const FAIL_COUNT_PATTERN = /^\d+\s+fail$/;
const ERROR_COUNT_PATTERN = /^(\d+)\s+errors?$/;
const MAX_MESSAGE_LINES = 12;

const MODULE_LOAD_SIGNATURES: readonly RegExp[] = [
  /\bSyntaxError\b/,
  /\bExport named\b/,
  /\bCannot find module\b/,
  /\bCannot find package\b/,
  /\bCould not resolve\b/,
  /\bFailed to resolve\b/,
  /\bResolveMessage\b/,
  /\bBuildMessage\b/,
];

export function isModuleLoadErrorMessage(message: string): boolean {
  return MODULE_LOAD_SIGNATURES.some((pattern) => pattern.test(message));
}

export function countReportedUnhandledErrors(output: string): number {
  const lines = stripAnsi(output).split(/\r?\n/);
  let total = 0;
  let previous = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const match = line.match(ERROR_COUNT_PATTERN);
    if (match?.[1] !== undefined && FAIL_COUNT_PATTERN.test(previous)) {
      total += Number.parseInt(match[1], 10);
    }
    previous = line;
  }
  return total;
}

function collectMessage(lines: readonly string[], start: number): { text: string; next: number } {
  let cursor = start;
  if (FENCE_PATTERN.test((lines[cursor] ?? "").trim())) cursor++;
  const collected: string[] = [];
  while (cursor < lines.length && collected.length < MAX_MESSAGE_LINES) {
    const candidate = (lines[cursor] ?? "").trim();
    if (FENCE_PATTERN.test(candidate)) break;
    if (candidate === UNHANDLED_ERROR_MARKER) break;
    if (SUITE_HEADER_PATTERN.test(candidate)) break;
    if (candidate.length > 0) collected.push(candidate);
    cursor++;
  }
  const text = collected.length > 0 ? collected.join("\n") : "unspecified module-load error";
  return { text, next: cursor };
}

export function detectSuiteLoadFailures(output: string): SuiteLoadFailure[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const failures: SuiteLoadFailure[] = [];
  let activeSuite = UNKNOWN_SUITE_FILE;

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").trim();
    const header = line.match(SUITE_HEADER_PATTERN);
    if (header?.[1] !== undefined) {
      activeSuite = header[1];
      continue;
    }
    if (line !== UNHANDLED_ERROR_MARKER) continue;
    const message = collectMessage(lines, index + 1);
    failures.push({
      file: activeSuite,
      message: message.text,
      isModuleLoadFailure: isModuleLoadErrorMessage(message.text),
    });
    index = message.next;
  }

  const reported = countReportedUnhandledErrors(output);
  if (reported > failures.length) {
    failures.push({
      file: UNKNOWN_SUITE_FILE,
      message: `bun reported ${reported} unhandled error(s) but only ${failures.length} could be attributed to a test file`,
      isModuleLoadFailure: false,
    });
  }

  return failures;
}

export function formatSuiteLoadFailureReport(failures: readonly SuiteLoadFailure[]): string {
  const divider = "=".repeat(80);
  const loadCount = failures.filter((entry) => entry.isModuleLoadFailure).length;
  const headline =
    loadCount > 0
      ? `TEST FILES THAT FAILED TO LOAD: ${loadCount} of ${failures.length} run error(s)`
      : `UNHANDLED TEST RUN ERRORS: ${failures.length}`;
  const lines: string[] = [
    "",
    divider,
    `  [LOAD-FAILURE] ${headline}`,
    divider,
    "  A test file that fails to load registers ZERO tests. Its cases are never",
    "  counted as passed, failed, or skipped, so they vanish from the summary",
    "  above. This is a hard failure of the entire run.",
    "",
  ];
  for (const failure of failures) {
    const label = failure.isModuleLoadFailure ? "MODULE LOAD FAILURE" : "UNHANDLED RUN ERROR";
    lines.push(`  ${label}: ${failure.file}`);
    for (const messageLine of failure.message.split("\n")) {
      lines.push(`      ${messageLine}`);
    }
    lines.push("");
  }
  lines.push(divider);
  return lines.join("\n");
}
