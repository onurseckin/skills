import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as yaml from "js-yaml";
import { HarnessError } from "../../../core/errors/index.ts";

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

export function parseDurationOrNumber(raw: unknown): number | null {
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

export function parseBudgetsObject(raw: unknown): MindBudgetOverrides {
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
