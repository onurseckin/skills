import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentGrantRecord, JsonValue } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { DEFAULT_MIND_BUDGET, parseCharter, type ParsedCharter } from "./charter/index.ts";
import { bootstrapRepoGovernance, type RepoGovernanceStatus } from "../governance/index.ts";
import { initRun, loadRun, transact } from "../../engine/store/index.ts";
import { resolveCapsulesDir } from "../../core/shared/paths.ts";
import { initRepoPolicy } from "../../policy/index.ts";
import { readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { formatMindInitBrief } from "../../cli/commands/mind-init-brief.ts";
import { SkillAuditorPolicy } from "../../engine/scheduler/index.ts";

import {
  MANDATORY_MIND_COMPANION_AUDITORS,
  createMandatoryMindCompanionGrants,
  bootstrapMindLifecycleWithCompanions,
  deployMandatoryMindCompanions,
  verifyMindCompanionBootstrapping,
  assertMindCompanionBootstrapping,
  type MindCompanionAuditorRole,
  type MindCompanionDeploymentOptions,
  type MindCompanionDeploymentResult,
} from "./mind-companions.ts";

export {
  MANDATORY_MIND_COMPANION_AUDITORS,
  createMandatoryMindCompanionGrants,
  bootstrapMindLifecycleWithCompanions,
  deployMandatoryMindCompanions,
  verifyMindCompanionBootstrapping,
  assertMindCompanionBootstrapping,
  type MindCompanionAuditorRole,
  type MindCompanionDeploymentOptions,
  type MindCompanionDeploymentResult,
};

export interface MindInitLifecycleOptions {
  readonly repo: string;
  readonly charter: string;
  readonly mindId?: string | undefined;
  readonly generation?: number | undefined;
  readonly actor?: string | undefined;
  readonly host?: string | undefined;
}

export interface MindInitLifecycleResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly mind_id: string;
  readonly generation: number;
  readonly charter_sha256: string;
  readonly charter: {
    readonly source_path: string;
    readonly goals: readonly string[];
    readonly repo_roots: readonly string[];
  };
  readonly manifest: unknown;
  readonly governance: RepoGovernanceStatus;
  readonly companions: MindCompanionDeploymentResult;
}

export function initializeMindLifecycle(
  options: MindInitLifecycleOptions,
): MindInitLifecycleResult {
  const repoRaw = options.repo;
  if (!existsSync(repoRaw) || !lstatSync(repoRaw).isDirectory()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `repository root must be an existing directory: ${repoRaw}`,
    );
  }
  const repoRoot = realpathSync(repoRaw);
  const oltDir = join(repoRoot, ".olt");
  if (!existsSync(oltDir)) mkdirSync(oltDir, { recursive: true });
  if (!existsSync(join(oltDir, "policy.json"))) {
    initRepoPolicy(repoRoot);
  }

  const charterPathRaw = options.charter;
  if (!charterPathRaw) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--charter is required: provide path to the owner's charter file per CONTRACTS.md §5.1",
    );
  }

  const resolvedCharterPath = isAbsolute(charterPathRaw)
    ? charterPathRaw
    : resolve(repoRoot, charterPathRaw);

  if (!existsSync(resolvedCharterPath) || !lstatSync(resolvedCharterPath).isFile()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `cannot read charter file at '${charterPathRaw}': must be an existing regular file and not a symlink or directory`,
    );
  }

  const charterText = readFileSync(resolvedCharterPath, "utf-8");
  if (charterText.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `charter file is empty: '${charterPathRaw}'; provide a valid markdown charter per CONTRACTS.md §7`,
    );
  }

  const parsedCharter: ParsedCharter = parseCharter(charterText);
  const generation = options.generation ?? 1;
  const mindId = options.mindId ?? (generation > 1 ? `mind-gen-${generation}` : "mind-gen-1");
  const actor = options.actor ?? "owner";
  const host = options.host ?? "initialization";
  const relativeCharterPath = relative(repoRoot, resolvedCharterPath) || charterPathRaw;

  const targetCapsuleDir = join(resolveCapsulesDir(repoRoot), mindId);
  if (existsSync(targetCapsuleDir)) {
    throw new HarnessError(
      "INVALID_STATE",
      `capsule already exists at ${targetCapsuleDir}; cannot re-initialize an existing mind capsule`,
    );
  }

  const charterBytes = new TextEncoder().encode(charterText);
  const runRoot = initRun(repoRoot, mindId, charterBytes, "file", true);
  const loaded = loadRun(runRoot);
  const pinnedDigest = loaded.manifest.prompt_sha256;
  const dayKey = new Date().toISOString().slice(0, 10);
  const budgets = parsedCharter.budgets;
  const nowIso = new Date().toISOString();

  transact(
    runRoot,
    actor,
    "mind-initialized",
    {
      generation,
      charter_source_path: relativeCharterPath,
      pinned_digest: pinnedDigest,
    },
    (state) => {
      state.mind = {
        generation,
        opened_at: nowIso,
        charter: {
          source_path: relativeCharterPath,
          pinned_sha256: pinnedDigest,
          goals: parsedCharter.goalIds as string[],
          repo_roots: parsedCharter.repoRoots as string[],
          evidence_class: "harness_observed",
        },
        previous_generation: null,
      } as unknown as JsonValue;

      state.budget = {
        pulses_per_day: budgets?.pulses_per_day ?? DEFAULT_MIND_BUDGET.pulses_per_day,
        wall_clock_ms_per_day:
          budgets?.wall_clock_ms_per_day ?? DEFAULT_MIND_BUDGET.wall_clock_ms_per_day,
        max_agents_in_flight:
          budgets?.max_agents_in_flight ?? DEFAULT_MIND_BUDGET.max_agents_in_flight,
        max_rounds_per_objective:
          budgets?.max_rounds_per_objective ?? DEFAULT_MIND_BUDGET.max_rounds_per_objective,
        base_interval_ms: budgets?.base_interval_ms ?? DEFAULT_MIND_BUDGET.base_interval_ms,
        max_interval_ms: budgets?.max_interval_ms ?? DEFAULT_MIND_BUDGET.max_interval_ms,
        max_pause_interval_ms:
          budgets?.max_pause_interval_ms ?? DEFAULT_MIND_BUDGET.max_pause_interval_ms,
        pulse_deadline_ms: budgets?.pulse_deadline_ms ?? DEFAULT_MIND_BUDGET.pulse_deadline_ms,
        max_open_proposals: budgets?.max_open_proposals ?? DEFAULT_MIND_BUDGET.max_open_proposals,
        quiet_hours:
          budgets?.quiet_hours !== undefined
            ? budgets.quiet_hours
            : DEFAULT_MIND_BUDGET.quiet_hours,
        day_key: dayKey,
        pulses_today: 0,
        wall_clock_ms_today: 0,
      } as unknown as JsonValue;

      state.pulse = {
        counter: 0,
        open: null,
        last: null,
      } as unknown as JsonValue;

      const initialGrants: AgentGrantRecord[] = [
        {
          id: mindId,
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host,
          granted_at: nowIso,
          status: "active",
        },
      ];

      if (actor && actor !== mindId) {
        initialGrants.push({
          id: actor,
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host,
          granted_at: nowIso,
          status: "active",
        });
      }

      // Hardwire mandatory companion auditors (mind-auditor and skill-auditor)
      const grantsWithCompanions = bootstrapMindLifecycleWithCompanions(mindId, initialGrants, {
        host,
        now: nowIso,
      });

      writeAgentLedger(state, grantsWithCompanions);

      state.observations = [] as unknown as JsonValue;
      state.candidates = [] as unknown as JsonValue;
      state.escalations = [] as unknown as JsonValue;
      state.audit = {
        last_started_at: null,
        last_verdict: null,
        open_findings: [],
      } as unknown as JsonValue;
    },
  );

  atomicWriteJson(join(runRoot, "last_pulse.json"), {
    at: new Date().toISOString(),
    pulse_id: null,
    outcome: null,
    next_wake_at: null,
  });

  const governance = bootstrapRepoGovernance({
    repoRoot,
    runRoot,
    mindId,
  });

  const companions = deployMandatoryMindCompanions(mindId, {
    mindId,
    runRoot,
    repoRoot,
    host,
    now: nowIso,
  });

  const markdown = formatMindInitBrief({
    mindId,
    runRoot,
    generation,
    charterSourcePath: relativeCharterPath,
    charterSha256: pinnedDigest,
    goals: parsedCharter.goalIds,
    repoRoots: parsedCharter.repoRoots,
    governance,
  });

  return {
    markdown,
    run_root: runRoot,
    mind_id: mindId,
    generation,
    charter_sha256: pinnedDigest,
    charter: {
      source_path: relativeCharterPath,
      goals: parsedCharter.goalIds,
      repo_roots: parsedCharter.repoRoots,
    },
    manifest: loaded.manifest,
    governance,
    companions,
  };
}
