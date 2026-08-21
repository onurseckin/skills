import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export interface CharterGoal {
  readonly id: string;
  readonly statement: string;
}

export interface StabilityCheck {
  readonly command: string;
  readonly expectedExit: number;
}

export interface MindBudgetOverrides {
  readonly pulses_per_day?: number;
  readonly wall_clock_ms_per_day?: number;
  readonly max_agents_in_flight?: number;
  readonly max_rounds_per_objective?: number;
  readonly base_interval_ms?: number;
  readonly max_interval_ms?: number;
  readonly max_pause_interval_ms?: number;
  readonly pulse_deadline_ms?: number;
  readonly max_open_proposals?: number;
  readonly quiet_hours?: string | null;
}

export interface MindBudget {
  pulses_per_day: number;
  wall_clock_ms_per_day: number;
  max_agents_in_flight: number;
  max_rounds_per_objective: number;
  base_interval_ms: number;
  max_interval_ms: number;
  max_pause_interval_ms: number;
  pulse_deadline_ms: number;
  max_open_proposals: number;
  quiet_hours: string | null;
  day_key: string;
  pulses_today: number;
  wall_clock_ms_today: number;
}

export const DEFAULT_MIND_BUDGET: Omit<MindBudget, "day_key" | "pulses_today" | "wall_clock_ms_today"> = {
  pulses_per_day: 96,
  wall_clock_ms_per_day: 21600000, // 6 hours
  max_agents_in_flight: 8,
  max_rounds_per_objective: 3,
  base_interval_ms: 900000, // 15 minutes
  max_interval_ms: 14400000, // 4 hours
  max_pause_interval_ms: 1800000, // 30 minutes
  pulse_deadline_ms: 1200000, // 20 minutes
  max_open_proposals: 5,
  quiet_hours: null,
};

export const DEFAULT_PROHIBITIONS = `NEVER, unattended, at any tier:
- git push, git push --force, merge or rebase onto a default branch, branch or tag deletion, history rewrite, git reset --hard on a dirty tree
- any write outside charter.repo_roots, any delete outside a leased write scope, rm -rf anywhere, chmod/chown outside the capsule
- package publish, deploy, DB migration, infrastructure change, creating or commenting on issues/PRs, sending mail, any outbound webhook
- secrets: reading, writing, printing, or moving credentials of any kind
- self-modification: editing CHARTER.md, editing any role contract, editing budgets, installing/upgrading/relinking the harness runtime
- process termination without ancestry check, and NEVER agy, claude, wezterm-gui, tmux, zsh/bash/login/sh and their subprocesses`;

export interface ParsedCharter {
  readonly identity: string;
  readonly goals: readonly CharterGoal[];
  readonly goalIds: readonly string[];
  readonly nonGoals: readonly string[];
  readonly repoRoots: readonly string[];
  readonly stability?: readonly StabilityCheck[];
  readonly budgets?: MindBudgetOverrides;
  readonly prohibitions?: string;
  readonly escalation?: string;
  readonly openQuestions?: readonly string[];
  readonly rawText: string;
  readonly sha256: string;
}

function normalizeHeading(raw: string): string {
  return raw
    .trim()
    .replace(/^#+\s*/, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function parseDurationOrNumber(raw: string): number {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("ms")) {
    const val = Number(lower.slice(0, -2).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val);
  }
  if (lower.endsWith("s")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 1000);
  }
  if (lower.endsWith("m")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 60 * 1000);
  }
  if (lower.endsWith("h")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 60 * 60 * 1000);
  }
  if (lower.endsWith("d")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 24 * 60 * 60 * 1000);
  }
  const val = Number(trimmed);
  if (Number.isFinite(val) && val >= 0) return Math.round(val);
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `invalid budget value '${raw}'; expected a non-negative number or duration (e.g. 15m, 4h, 900000)`,
  );
}

function parseBudgetsSection(lines: readonly string[]): MindBudgetOverrides {
  const overrides: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*+]\s*/, "");
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    const eqIdx = trimmed.indexOf("=");
    const splitIdx = colonIdx >= 0 ? colonIdx : eqIdx;
    if (splitIdx < 0) continue;
    const key = trimmed.slice(0, splitIdx).trim().toLowerCase().replace(/[\s/-]+/g, "_");
    const value = trimmed.slice(splitIdx + 1).trim();

    if (key === "pulses_per_day" || key === "pulses_day") {
      overrides.pulses_per_day = parseDurationOrNumber(value);
    } else if (key === "wall_clock_ms_per_day" || key === "wall_clock_per_day" || key === "wall_clock_day") {
      overrides.wall_clock_ms_per_day = parseDurationOrNumber(value);
    } else if (key === "max_agents_in_flight" || key === "max_concurrent_agents") {
      overrides.max_agents_in_flight = parseDurationOrNumber(value);
    } else if (key === "max_rounds_per_objective") {
      overrides.max_rounds_per_objective = parseDurationOrNumber(value);
    } else if (key === "base_interval_ms" || key === "base_interval") {
      overrides.base_interval_ms = parseDurationOrNumber(value);
    } else if (key === "max_interval_ms" || key === "max_interval") {
      overrides.max_interval_ms = parseDurationOrNumber(value);
    } else if (key === "max_pause_interval_ms" || key === "max_pause_interval") {
      overrides.max_pause_interval_ms = parseDurationOrNumber(value);
    } else if (key === "pulse_deadline_ms" || key === "pulse_deadline") {
      overrides.pulse_deadline_ms = parseDurationOrNumber(value);
    } else if (key === "max_open_proposals") {
      overrides.max_open_proposals = parseDurationOrNumber(value);
    } else if (key === "quiet_hours") {
      overrides.quiet_hours = value === "null" || value === "none" || value === "" ? null : value;
    }
  }
  return overrides as MindBudgetOverrides;
}

function parseStabilitySection(lines: readonly string[]): StabilityCheck[] {
  const checks: StabilityCheck[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Match - `<argv>` → exit <n> or - `<argv>` -> exit <n> or - `<argv>` exit <n>
    const match = trimmed.match(/^[-*+]?\s*`([^`]+)`\s*(?:→|->|:)?\s*exit\s*(\d+)/i);
    if (match) {
      checks.push({
        command: match[1]!.trim(),
        expectedExit: parseInt(match[2]!, 10),
      });
    }
  }
  return checks;
}

export function parseCharter(markdown: string): ParsedCharter {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter content is empty; provide a non-empty markdown charter per CONTRACTS.md §7",
    );
  }

  const sha256 = createHash("sha256").update(markdown).digest("hex");
  const lines = markdown.split("\n");
  const sections = new Map<string, string[]>();

  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      if (currentHeading !== null) {
        sections.set(currentHeading, currentLines);
      }
      currentHeading = normalizeHeading(match[2]!);
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.set(currentHeading, currentLines);
  }

  // Check mandatory section 1: identity
  const identityLines = sections.get("identity");
  if (!identityLines) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: identity. Expected '## identity' heading per CONTRACTS.md §7. To satisfy, add '## identity' with one paragraph describing the application.",
    );
  }
  const identity = identityLines.join("\n").trim();
  if (!identity) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter '## identity' section is empty. Expected prose describing the application per CONTRACTS.md §7.",
    );
  }

  // Check mandatory section 2: goals
  const goalsLines = sections.get("goals");
  if (!goalsLines) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: goals. Expected '## goals' heading with '- G<n>: <statement>' lines per CONTRACTS.md §7.",
    );
  }
  const goals: CharterGoal[] = [];
  for (const line of goalsLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^[-*+]?\s*\[?(G[A-Za-z0-9_.-]+)\]?\s*[:\-–]\s*(.+)$/i);
    if (match) {
      goals.push({
        id: match[1]!.toUpperCase(),
        statement: match[2]!.trim(),
      });
    }
  }
  if (goals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter '## goals' section contains no valid goal lines. Expected format: '- G<n>: <statement>' (e.g. '- G1: Maintain 100% test coverage') per CONTRACTS.md §7.",
    );
  }

  // Check mandatory section 3: non-goals
  const nonGoalsLines = sections.get("non_goals") ?? sections.get("nongoals");
  if (!nonGoalsLines) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: non-goals. Expected '## non-goals' heading with '- <statement>' lines per CONTRACTS.md §7.",
    );
  }
  const nonGoals: string[] = [];
  for (const line of nonGoalsLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^[-*+]\s+(.+)$/);
    if (match) {
      nonGoals.push(match[1]!.trim());
    }
  }
  if (nonGoals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter '## non-goals' section contains no items. Expected format: '- <exclusion statement>' per CONTRACTS.md §7.",
    );
  }

  // Check mandatory section 4: repo_roots
  const repoRootsLines = sections.get("repo_roots") ?? sections.get("reporoots");
  if (!repoRootsLines) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: repo_roots. Expected '## repo_roots' heading with backticked paths (e.g. - `src/`) per CONTRACTS.md §7.",
    );
  }
  const repoRoots: string[] = [];
  for (const line of repoRootsLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const backticks = Array.from(trimmed.matchAll(/`([^`]+)`/g)).map((m) => m[1]!.trim());
    if (backticks.length > 0) {
      for (const p of backticks) {
        if (p && !repoRoots.includes(p)) repoRoots.push(p);
      }
    } else {
      const match = trimmed.match(/^[-*+]\s+(.+)$/);
      if (match) {
        const p = match[1]!.trim();
        if (p && !repoRoots.includes(p)) repoRoots.push(p);
      }
    }
  }
  if (repoRoots.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter '## repo_roots' section contains no valid paths. Expected format: '- `path/`' per CONTRACTS.md §7.",
    );
  }

  // Optional section: stability
  const stabilityLines = sections.get("stability");
  const stability = stabilityLines ? parseStabilitySection(stabilityLines) : undefined;

  // Optional section: budgets
  const budgetsLines = sections.get("budgets") ?? sections.get("budget");
  const budgets = budgetsLines ? parseBudgetsSection(budgetsLines) : undefined;

  // Optional section: prohibitions
  const prohibitionsLines = sections.get("prohibitions") ?? sections.get("prohibition");
  const prohibitions = prohibitionsLines ? prohibitionsLines.join("\n").trim() : undefined;

  // Optional section: escalation
  const escalationLines = sections.get("escalation") ?? sections.get("escalations");
  const escalation = escalationLines ? escalationLines.join("\n").trim() : undefined;

  // Optional section: open_questions
  const openQuestionsLines = sections.get("open_questions") ?? sections.get("openquestions");
  let openQuestions: string[] | undefined;
  if (openQuestionsLines) {
    openQuestions = [];
    for (const line of openQuestionsLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^[-*+]\s+(.+)$/);
      if (match) {
        openQuestions.push(match[1]!.trim());
      } else if (trimmed) {
        openQuestions.push(trimmed);
      }
    }
  }

  return {
    identity,
    goals,
    goalIds: goals.map((g) => g.id),
    nonGoals,
    repoRoots,
    ...(stability !== undefined ? { stability } : {}),
    ...(budgets !== undefined ? { budgets } : {}),
    ...(prohibitions !== undefined ? { prohibitions } : {}),
    ...(escalation !== undefined ? { escalation } : {}),
    ...(openQuestions !== undefined && openQuestions.length > 0 ? { openQuestions } : {}),
    rawText: markdown,
    sha256,
  };
}

export function resolveCharterPath(
  repoRoot: string,
  charterSourceRel: string,
  charterRepoRoots?: readonly string[],
): string {
  const filename = charterSourceRel.split("/").pop();
  const candidates = [
    resolve(repoRoot, charterSourceRel),
    ...(charterRepoRoots ? charterRepoRoots.map((r) => resolve(r, charterSourceRel)) : []),
    resolve(repoRoot, charterSourceRel.replace(/^(\.\.\/)+/, "")),
    ...(filename ? [resolve(repoRoot, "docs", filename)] : []),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && lstatSync(candidate).isFile()) {
      return candidate;
    }
  }
  return resolve(repoRoot, charterSourceRel);
}
