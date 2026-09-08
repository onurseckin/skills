#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";

export type AttributionRule =
  | "ai-attribution-trailer"
  | "claude-session-trailer"
  | "generated-with-phrase";

export interface AttributionViolation {
  readonly line: number;
  readonly rule: AttributionRule;
  readonly text: string;
  readonly detail: string;
}

export interface CommitMessageAudit {
  readonly passed: boolean;
  readonly violations: readonly AttributionViolation[];
}

export const AI_VENDOR_PATTERN =
  /(claude|anthropic|copilot|cursor|gemini|gpt|codex|noreply@anthropic)/i;

export const ATTRIBUTION_TRAILER_KEYS: readonly string[] = [
  "co-authored-by",
  "assisted-by",
  "co-created-with",
];

export const FORBIDDEN_TRAILER_KEYS: readonly string[] = ["claude-session"];

interface PhraseRule {
  readonly pattern: RegExp;
  readonly detail: string;
}

const PHRASE_RULES: readonly PhraseRule[] = [
  {
    pattern: /\u{1F916}\s*generated with/iu,
    detail: "robot-emoji generated-with attribution banner",
  },
  {
    pattern: /generated with\s*\[\s*claude code\s*\]/i,
    detail: "'Generated with [Claude Code]' attribution banner",
  },
  {
    pattern: /generated with\s+claude/i,
    detail: "'Generated with Claude' attribution banner",
  },
];

export const TRAILER_PATTERN = /^\s*(?:#+[\s#]*)?([A-Za-z][A-Za-z0-9-]*)[ \t]*:[ \t]*(.*)$/;

export const SCISSORS_PATTERN = /^\s*#\s*-{2,}\s*(?:>8|8<)\s*-{2,}/;

export const GIT_SCISSORS_PREAMBLE_LINE1 = "# Do not modify or remove the line above.";
export const GIT_SCISSORS_PREAMBLE_LINE2 = "# Everything below it will be ignored.";

export function extractPreScissorsLines(message: string): readonly string[] {
  const lines = message.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (SCISSORS_PATTERN.test(line)) {
      const next1 = lines[i + 1]?.trim();
      const next2 = lines[i + 2]?.trim();
      if (next1 === GIT_SCISSORS_PREAMBLE_LINE1 && next2 === GIT_SCISSORS_PREAMBLE_LINE2) {
        break;
      }
    }
    kept.push(line);
  }
  return kept;
}

function inspectTrailer(line: string): { rule: AttributionRule; detail: string } | undefined {
  const match = TRAILER_PATTERN.exec(line);
  if (!match) return undefined;
  const key = (match[1] ?? "").toLowerCase();
  const value = match[2] ?? "";

  if (FORBIDDEN_TRAILER_KEYS.includes(key)) {
    return {
      rule: "claude-session-trailer",
      detail: `'${match[1]}:' is an AI session trailer and is never allowed`,
    };
  }

  if (ATTRIBUTION_TRAILER_KEYS.includes(key)) {
    const vendor = AI_VENDOR_PATTERN.exec(value);
    if (vendor) {
      return {
        rule: "ai-attribution-trailer",
        detail: `'${match[1]}:' trailer credits AI vendor '${vendor[0]}'`,
      };
    }
  }

  return undefined;
}

function inspectPhrases(line: string): { rule: AttributionRule; detail: string } | undefined {
  for (const phrase of PHRASE_RULES) {
    if (phrase.pattern.test(line)) {
      return { rule: "generated-with-phrase", detail: phrase.detail };
    }
  }
  return undefined;
}

export function auditCommitMessage(message: string): CommitMessageAudit {
  const violations: AttributionViolation[] = [];
  const lines = extractPreScissorsLines(message);

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const finding = inspectTrailer(line) ?? inspectPhrases(line);
    if (finding) {
      violations.push({
        line: index + 1,
        rule: finding.rule,
        text: line.trim(),
        detail: finding.detail,
      });
    }
  }

  return { passed: violations.length === 0, violations };
}

export function formatViolationReport(violations: readonly AttributionViolation[]): string {
  const header = "❌ [commit-msg-guard] AI attribution is forbidden in this repository.";
  const rows = violations.map(
    (violation) =>
      `  line ${violation.line} [${violation.rule}]: ${violation.text}\n      ${violation.detail}`,
  );
  const footer = [
    "",
    "Remove every AI/tool attribution line from the commit message and retry.",
    "Forbidden: Co-Authored-By / Assisted-By / Co-Created-With naming an AI vendor,",
    "Claude-Session trailers, and 'Generated with ...' banners.",
  ].join("\n");
  return [header, ...rows, footer].join("\n");
}

export function runCommitMsgGuard(argvArgs: string[] = process.argv.slice(2)): number {
  const messagePath = argvArgs.find((arg) => !arg.startsWith("-"));
  if (messagePath === undefined || messagePath.length === 0) {
    console.error("❌ [commit-msg-guard] No commit message file path was provided.");
    return 1;
  }

  if (!existsSync(messagePath)) {
    console.error(`❌ [commit-msg-guard] Commit message file not found: ${messagePath}`);
    return 1;
  }

  let message = "";
  try {
    message = String(readFileSync(messagePath, "utf-8"));
  } catch (error) {
    console.error(`❌ [commit-msg-guard] Unable to read ${messagePath}:`, error);
    return 1;
  }

  const audit = auditCommitMessage(message);
  if (audit.passed) return 0;

  console.error(formatViolationReport(audit.violations));
  return 1;
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  return entryArg.endsWith("git/commit-msg-guard.ts") || entryArg.endsWith("git/commit-msg-guard");
}

export function main(argvArgs: string[] = process.argv.slice(2)): number {
  try {
    return runCommitMsgGuard(argvArgs);
  } catch (error) {
    console.error("❌ [commit-msg-guard] Execution error:", error);
    return 1;
  }
}

if (computeIsMain()) {
  process.exit(main());
}
