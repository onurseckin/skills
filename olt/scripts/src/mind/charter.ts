import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as yaml from "js-yaml";
import { HarnessError } from "../core/errors/index.ts";

export interface CharterGoal {
  readonly id: string;
  readonly statement: string;
}

export interface StabilityCheck {
  readonly command: string;
  readonly expectedExit: number;
}

export interface MindBudgetOverrides {
  readonly cadence?: string | undefined;
  readonly concurrency_model?: string | undefined;
  readonly infinite_cadence?: boolean | undefined;
  readonly pulses_per_day?: number | null;
  readonly wall_clock_ms_per_day?: number | null;
  readonly max_agents_in_flight?: number | null;
  readonly max_rounds_per_objective?: number | null;
  readonly base_interval_ms?: number;
  readonly max_interval_ms?: number | null;
  readonly max_pause_interval_ms?: number | null;
  readonly pulse_deadline_ms?: number;
  readonly max_open_proposals?: number | null;
  readonly quiet_hours?: string | null;
}

export interface MindBudget {
  cadence?: string | undefined;
  concurrency_model?: string | undefined;
  infinite_cadence?: boolean | undefined;
  pulses_per_day: number | null;
  wall_clock_ms_per_day: number | null;
  max_agents_in_flight: number | null;
  max_rounds_per_objective: number | null;
  base_interval_ms: number;
  max_interval_ms: number | null;
  max_pause_interval_ms: number | null;
  pulse_deadline_ms: number;
  max_open_proposals: number | null;
  quiet_hours: string | null;
  day_key: string;
  pulses_today: number;
  wall_clock_ms_today: number;
}

export const DEFAULT_MIND_BUDGET: Omit<
  MindBudget,
  "day_key" | "pulses_today" | "wall_clock_ms_today"
> = {
  cadence: "infinite_borderless",
  concurrency_model: "topological_work_span",
  infinite_cadence: true,
  pulses_per_day: null,
  wall_clock_ms_per_day: null,
  max_agents_in_flight: null,
  max_rounds_per_objective: null,
  base_interval_ms: 0,
  max_interval_ms: null,
  max_pause_interval_ms: null,
  pulse_deadline_ms: 1200000, // 20 minutes
  max_open_proposals: null,
  quiet_hours: null,
};

export const DEFAULT_PROHIBITIONS = `NEVER, unattended, at any tier:
- git push, git push --force, merge or rebase onto a default branch, branch or tag deletion, history rewrite, git reset --hard on a dirty tree
- any write outside charter.repo_roots, any delete outside a leased write scope, rm -rf anywhere, chmod/chown outside the capsule
- package publish, deploy, DB migration, infrastructure change, creating or commenting on issues/PRs, sending mail, any outbound webhook
- secrets: reading, writing, printing, or moving credentials of any kind
- self-modification: editing mind.yaml, editing any role contract, editing budgets, installing/upgrading/relinking the harness runtime
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

function parseDurationOrNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (Number.isFinite(raw) && raw >= 0) return Math.round(raw);
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid budget value '${raw}'; expected a non-negative number`,
    );
  }
  if (typeof raw !== "string") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid budget value '${String(raw)}'; expected string or number`,
    );
  }
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower === "infinity" ||
    lower === "infinite" ||
    lower === "unlimited" ||
    lower === "none" ||
    lower === "borderless" ||
    lower.startsWith("topological") ||
    lower.includes("p = w / s") ||
    lower.includes("p=w/s") ||
    lower.includes("w/s")
  ) {
    return null;
  }
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
    `invalid budget value '${raw}'; expected a non-negative number, duration (e.g. 15m, 4h, 900000), or infinite/topological specification`,
  );
}

function parseBudgetsObject(raw: unknown): MindBudgetOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const overrides: Record<string, unknown> = {};

  if (typeof obj.cadence === "string") {
    overrides.cadence = obj.cadence;
    if (
      obj.cadence.toLowerCase().includes("infinite") ||
      obj.cadence.toLowerCase().includes("borderless")
    ) {
      overrides.infinite_cadence = true;
    }
  }
  if (typeof obj.concurrency_model === "string" || typeof obj.concurrency === "string") {
    overrides.concurrency_model = String(obj.concurrency_model ?? obj.concurrency);
  }
  if (typeof obj.infinite_cadence === "boolean") {
    overrides.infinite_cadence = obj.infinite_cadence;
  }
  if (obj.pulses_per_day !== undefined) {
    overrides.pulses_per_day = parseDurationOrNumber(obj.pulses_per_day);
  }
  if (obj.wall_clock_ms_per_day !== undefined) {
    overrides.wall_clock_ms_per_day = parseDurationOrNumber(obj.wall_clock_ms_per_day);
  }
  if (obj.max_agents_in_flight !== undefined) {
    overrides.max_agents_in_flight = parseDurationOrNumber(obj.max_agents_in_flight);
  }
  if (obj.max_rounds_per_objective !== undefined) {
    overrides.max_rounds_per_objective = parseDurationOrNumber(obj.max_rounds_per_objective);
  }
  if (obj.base_interval_ms !== undefined) {
    overrides.base_interval_ms = parseDurationOrNumber(obj.base_interval_ms);
  }
  if (obj.max_interval_ms !== undefined) {
    overrides.max_interval_ms = parseDurationOrNumber(obj.max_interval_ms);
  }
  if (obj.max_pause_interval_ms !== undefined) {
    overrides.max_pause_interval_ms = parseDurationOrNumber(obj.max_pause_interval_ms);
  }
  if (obj.pulse_deadline_ms !== undefined) {
    overrides.pulse_deadline_ms = parseDurationOrNumber(obj.pulse_deadline_ms);
  }
  if (obj.max_open_proposals !== undefined) {
    overrides.max_open_proposals = parseDurationOrNumber(obj.max_open_proposals);
  }
  if (obj.quiet_hours !== undefined) {
    overrides.quiet_hours =
      obj.quiet_hours === null || obj.quiet_hours === "none" ? null : String(obj.quiet_hours);
  }

  return overrides as MindBudgetOverrides;
}

export function parseCharterFromYaml(
  doc: Record<string, unknown>,
  rawText: string,
  sha256: string,
): ParsedCharter {
  const rawCharter = (
    doc.charter && typeof doc.charter === "object" && !Array.isArray(doc.charter)
      ? doc.charter
      : doc
  ) as Record<string, unknown>;

  // Mandatory identity
  const identity = typeof rawCharter.identity === "string" ? rawCharter.identity.trim() : "";
  if (!identity) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: identity. Expected 'identity' field in YAML manifest.",
    );
  }

  // Mandatory goals
  const rawGoals = rawCharter.goals;
  if (!rawGoals || !Array.isArray(rawGoals) || rawGoals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: goals. Expected 'goals' array in YAML manifest.",
    );
  }

  const goals: CharterGoal[] = [];
  for (const item of rawGoals as unknown[]) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const gObj = item as Record<string, unknown>;
      if (typeof gObj.id === "string" && typeof gObj.statement === "string") {
        goals.push({
          id: gObj.id.toUpperCase().trim(),
          statement: gObj.statement.trim(),
        });
      }
    } else if (typeof item === "string") {
      const match = item.trim().match(/^[-*+]?\s*\[?(G[A-Za-z0-9_.-]+)\]?\s*[:\-–]\s*(.+)$/i);
      if (match) {
        goals.push({
          id: match[1]!.toUpperCase(),
          statement: match[2]!.trim(),
        });
      }
    }
  }

  if (goals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter 'goals' section contains no valid goal items. Expected list of {id, statement} in YAML manifest.",
    );
  }

  // Mandatory non-goals
  const rawNonGoals = (rawCharter.non_goals ?? rawCharter.nonGoals) as unknown;
  if (!rawNonGoals || !Array.isArray(rawNonGoals) || rawNonGoals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: non-goals. Expected 'non_goals' array in YAML manifest.",
    );
  }

  const nonGoals: string[] = [];
  for (const item of rawNonGoals as unknown[]) {
    if (typeof item === "string" && item.trim()) {
      nonGoals.push(item.trim().replace(/^[-*+]\s*/, ""));
    }
  }

  if (nonGoals.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "charter 'non_goals' section contains no items.");
  }

  // Mandatory repo_roots
  const rawRepoRoots = (rawCharter.repo_roots ?? rawCharter.repoRoots) as unknown;
  if (!rawRepoRoots || !Array.isArray(rawRepoRoots) || rawRepoRoots.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: repo_roots. Expected 'repo_roots' array in YAML manifest.",
    );
  }

  const repoRoots: string[] = [];
  for (const item of rawRepoRoots as unknown[]) {
    if (typeof item === "string" && item.trim()) {
      const clean = item
        .trim()
        .replace(/`/g, "")
        .replace(/^[-*+]\s*/, "");
      if (clean && !repoRoots.includes(clean)) {
        repoRoots.push(clean);
      }
    }
  }

  if (repoRoots.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter 'repo_roots' section contains no valid paths.",
    );
  }

  // Optional stability
  let stability: StabilityCheck[] | undefined;
  const rawStability = rawCharter.stability as unknown;
  if (Array.isArray(rawStability) && rawStability.length > 0) {
    stability = [];
    for (const item of rawStability as unknown[]) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const sObj = item as Record<string, unknown>;
        if (typeof sObj.command === "string") {
          stability.push({
            command: sObj.command.trim(),
            expectedExit: typeof sObj.expectedExit === "number" ? sObj.expectedExit : 0,
          });
        }
      } else if (typeof item === "string") {
        const match = item.trim().match(/^[-*+]?\s*`?([^`→\-:]+)`?\s*(?:→|->|:)?\s*exit\s*(\d+)/i);
        if (match) {
          stability.push({
            command: match[1]!.trim(),
            expectedExit: parseInt(match[2]!, 10),
          });
        }
      }
    }
  }

  // Optional budgets
  const rawBudgets = (rawCharter.budgets ?? rawCharter.budget) as unknown;
  const budgets = rawBudgets ? parseBudgetsObject(rawBudgets) : undefined;

  // Optional prohibitions
  let prohibitions: string | undefined;
  const rawProhibitions = rawCharter.prohibitions;
  if (typeof rawProhibitions === "string") {
    prohibitions = rawProhibitions.trim();
  } else if (Array.isArray(rawProhibitions)) {
    prohibitions = rawProhibitions
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .join("\n");
  }

  // Optional escalation
  let escalation: string | undefined;
  if (typeof rawCharter.escalation === "string") {
    escalation = rawCharter.escalation.trim();
  }

  // Optional open questions
  let openQuestions: string[] | undefined;
  const rawQuestions = (rawCharter.open_questions ?? rawCharter.openQuestions) as unknown;
  if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
    openQuestions = rawQuestions
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim());
  }

  return {
    identity,
    goals,
    goalIds: goals.map((g) => g.id),
    nonGoals,
    repoRoots,
    ...(stability !== undefined && stability.length > 0 ? { stability } : {}),
    ...(budgets !== undefined && Object.keys(budgets).length > 0 ? { budgets } : {}),
    ...(prohibitions !== undefined && prohibitions.length > 0 ? { prohibitions } : {}),
    ...(escalation !== undefined && escalation.length > 0 ? { escalation } : {}),
    ...(openQuestions !== undefined && openQuestions.length > 0 ? { openQuestions } : {}),
    rawText,
    sha256,
  };
}

export function parseCharter(content: string): ParsedCharter {
  if (typeof content !== "string" || !content.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter content is empty; provide a valid YAML agent manifest for mind",
    );
  }

  const sha256 = createHash("sha256").update(content).digest("hex");

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HarnessError("INVALID_ARGUMENT", `failed to parse mind YAML manifest: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "mind manifest must be a YAML object defining agent properties or structured charter",
    );
  }

  return parseCharterFromYaml(parsed as Record<string, unknown>, content, sha256);
}

export const parseCharterYaml = parseCharter;

export const DEFAULT_CHARTER_RELATIVE_PATH = "olt/agents/mind.yaml";

export function resolveCharterPath(
  repoRoot: string,
  charterSourceRel?: string,
  charterRepoRoots?: readonly string[],
): string {
  const isDefault = !charterSourceRel || charterSourceRel === DEFAULT_CHARTER_RELATIVE_PATH;
  const candidates: string[] = [];

  if (charterSourceRel && !isDefault) {
    const filename = charterSourceRel.split("/").pop() || charterSourceRel;
    candidates.push(resolve(repoRoot, charterSourceRel));
    candidates.push(resolve(repoRoot, "olt", "agents", filename));
    candidates.push(resolve(repoRoot, "agents", filename));
    if (charterRepoRoots && charterRepoRoots.length > 0) {
      for (const r of charterRepoRoots) {
        candidates.push(resolve(repoRoot, r, charterSourceRel));
        candidates.push(resolve(repoRoot, r, filename));
      }
    }
    candidates.push(resolve(repoRoot, filename));
    candidates.push(resolve(repoRoot, charterSourceRel.replace(/^(\.\.\/)+/, "")));
  } else {
    // Canonical YAML manifest SSoT lookup hierarchy: olt/agents/mind.yaml -> agents/mind.yaml
    candidates.push(resolve(repoRoot, "olt", "agents", "mind.yaml"));
    candidates.push(resolve(repoRoot, "agents", "mind.yaml"));
    if (charterRepoRoots && charterRepoRoots.length > 0) {
      for (const r of charterRepoRoots) {
        candidates.push(resolve(repoRoot, r, "olt", "agents", "mind.yaml"));
        candidates.push(resolve(repoRoot, r, "agents", "mind.yaml"));
      }
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate) && lstatSync(candidate).isFile()) {
      return candidate;
    }
  }
  return resolve(repoRoot, charterSourceRel || DEFAULT_CHARTER_RELATIVE_PATH);
}

export function loadCharter(
  repoRoot: string,
  charterSourceRel?: string,
  charterRepoRoots?: readonly string[],
): ParsedCharter {
  const fullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);
  if (!existsSync(fullPath) || !lstatSync(fullPath).isFile()) {
    throw new HarnessError("INVALID_ARGUMENT", `mind manifest at '${fullPath}' does not exist`);
  }
  const text = readFileSync(fullPath, "utf-8");
  return parseCharter(text);
}
