import { lineOf } from "./scanner.ts";
import type { SourceFile } from "./sources.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

/**
 * B8.5 defect class 1: a plausible literal substituted for missing data. `?? "pending"` and
 * `|| "agent"` both report a value nobody measured. Rendering absence as absence is fine, so the
 * markers below are the vocabulary a fallback may legitimately reach for.
 */
const ABSENCE_MARKER = /^(?:no|none|not|unknown|unavailable|unrecorded)\b/u;

/** A whole literal that is nothing but a placeholder glyph. */
const ABSENCE_GLYPHS: ReadonlySet<string> = new Set(["-", "--", "\u2014", "?", "n/a"]);

/** Decorations a brief wraps a marker in. `\`none\`` and `**none**` still say "none". */
const DECORATION = /[`*_"']/gu;

/** The same admission made mid-phrase: "an unrecorded time" still reports absence. */
const ABSENCE_PHRASE = /\b(?:unknown|unrecorded|unavailable|not recorded|not applicable)\b/u;

/** `<AGENT>` in an example command line is a placeholder the reader fills in, not a claimed value. */
const PLACEHOLDER = /^<[^>]*>$/u;

function declaresAbsence(literal: string): boolean {
  const trimmed = literal.trim();
  if (PLACEHOLDER.test(trimmed)) return true;
  const stripped = trimmed.replace(DECORATION, "").trim().toLowerCase();
  if (stripped === "" || ABSENCE_GLYPHS.has(stripped)) return true;
  return ABSENCE_MARKER.test(stripped) || ABSENCE_PHRASE.test(stripped);
}

/**
 * Left-hand names whose value is a measurement: defaulting one to 0 reports a reading we lack.
 * A bound or a knob is excluded - `maxBytes ?? 64 * 1024` states a policy, it does not report one.
 */
const MEASUREMENT_WORDS: readonly string[] = [
  "exit",
  "code",
  "bytes",
  "duration",
  "elapsed",
  "seconds",
  "millis",
  "tokens",
  "cost",
  "usage",
  "score",
  "percent",
];

const STRING_FALLBACK = /([A-Za-z0-9_$.[\]?!)]+)\s*(\?\?|\|\|)\s*(["'])((?:\\.|(?!\3).)*)\3/gu;
const ZERO_FALLBACK = /([A-Za-z0-9_$.[\]?!)]+)\s*(\?\?|\|\|)\s*(-?\d+(?:\.\d+)?)\b/gu;

const POLICY_WORDS: readonly string[] = [
  "max",
  "min",
  "limit",
  "default",
  "budget",
  "threshold",
  "timeout",
  "grace",
  "capacity",
];

function isMeasurement(expression: string): boolean {
  const lowered = expression.toLowerCase();
  if (POLICY_WORDS.some((word) => lowered.includes(word))) return false;
  return MEASUREMENT_WORDS.some((word) => lowered.includes(word));
}

function scanFallbacks(file: SourceFile): HealthFinding[] {
  const code = file.scan.code;
  const findings: HealthFinding[] = [];
  for (const match of code.matchAll(STRING_FALLBACK)) {
    const literal = match[4] ?? "";
    if (declaresAbsence(literal)) continue;
    const line = lineOf(code, match.index);
    findings.push(
      finding(
        "literal-fallbacks",
        `string-fallback:${file.relative}:${match[1]}:${literal}`,
        file.relative,
        `\`${match[1]} ${match[2]} "${literal}"\` substitutes a plausible literal for a value the code did not have`,
        line,
      ),
    );
  }
  for (const match of code.matchAll(ZERO_FALLBACK)) {
    const left = match[1] ?? "";
    if (!isMeasurement(left)) continue;
    const line = lineOf(code, match.index);
    findings.push(
      finding(
        "literal-fallbacks",
        `numeric-fallback:${file.relative}:${left}:${match[3]}`,
        file.relative,
        `\`${left} ${match[2]} ${match[3]}\` reports a measurement that was never taken`,
        line,
      ),
    );
  }
  return findings;
}

export function checkLiteralFallbacks(files: readonly SourceFile[]): HealthCheckResult {
  return {
    check: "literal-fallbacks",
    title: "Literal fallbacks: a plausible value standing in for a missing one",
    findings: files.flatMap(scanFallbacks),
    scanned: files.length,
    limitations: [
      "Only `??` and `||` are inspected. The same substitution written as an `if` branch, a ternary, or a default parameter value is not detected.",
      "A numeric fallback is judged by the name on the left, so a measurement stored under a name with none of the known words reads as clean.",
    ],
  };
}
