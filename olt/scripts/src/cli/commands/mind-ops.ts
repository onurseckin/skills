import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentGrantRecord, JsonValue } from "../../core/contracts/index.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  DEFAULT_MIND_BUDGET,
  parseCharter,
  type ParsedCharter,
} from "../../mind/lifecycle/charter/index.ts";
import { bootstrapRepoGovernance, type RepoGovernanceStatus } from "../../mind/governance/index.ts";
import { initRun, loadRun, transact } from "../../engine/store/index.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { resolveCapsulesDir } from "../../core/shared/paths.ts";
import { PolicyDiscoveryEngine } from "../../engine/policy-discovery.ts";
import { writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { formatMindInitBrief } from "./mind-init-brief.ts";

export type MindInitGovernanceStatus = RepoGovernanceStatus;

export interface MindInitResult {
  markdown: string;
  run_root: string;
  mind_id: string;
  generation: number;
  charter_sha256: string;
  charter: {
    source_path: string;
    goals: readonly string[];
    repo_roots: readonly string[];
  };
  manifest: unknown;
  governance: RepoGovernanceStatus;
}

export { formatMindInitBrief } from "./mind-init-brief.ts";
export { mindObserveCommand } from "./mind-observe.ts";
export { mindPulseCommand } from "./mind-pulse.ts";
export { mindPulseOpenCommand } from "./mind-pulse-open.ts";
export { mindQuiesceCommand } from "./mind-quiesce.ts";
export { mindRotateCommand } from "./mind-rotate.ts";
export { mindWakeCommand } from "./mind-wake.ts";
export { mindHaltCommand } from "./mind-halt.ts";
export { mindCandidateCommand } from "./mind-candidate.ts";
export { mindAdmitCommand, mindDeclineCommand } from "./mind-admit.ts";
export { mindEscalateCommand } from "./mind-escalate.ts";
export { mindRoundOpenCommand, mindRoundCloseCommand } from "./mind-round.ts";
export { mindAuditStartCommand, mindAuditReportCommand } from "./mind-audit.ts";
export { mindAuditLiveCommand } from "./mind-audit-live.ts";

export function mindInitCommand(
  flags: Flags,
  _context: CommandContext = {},
): Record<string, unknown> {
  const repoRaw = textFlag(flags, "repo", false) ?? process.cwd();
  if (!existsSync(repoRaw) || !lstatSync(repoRaw).isDirectory()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `repository root must be an existing directory: ${repoRaw}`,
    );
  }
  const repoRoot = realpathSync(repoRaw);
  const oltDir = join(repoRoot, ".olt");
  if (!existsSync(oltDir)) mkdirSync(oltDir, { recursive: true });

  // Mandatory One-Time Policy Init Phase: inspect if .olt/policy.json exists; if missing or uncalibrated, calibrate
  PolicyDiscoveryEngine.ensurePolicyCalibrated(repoRoot);

  const charterPathRaw = textFlag(flags, "charter", true);
  if (!charterPathRaw) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--charter is required: provide path to the owner's charter file per CONTRACTS.md §5.1",
    );
  }

  const resolvedCharterPath = isAbsolute(charterPathRaw)
    ? charterPathRaw
    : resolve(repoRoot, charterPathRaw);

  let charterBytes: Uint8Array;
  try {
    charterBytes = readRegularFileNoFollow(resolvedCharterPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `cannot read charter file at '${charterPathRaw}': ${message}; must be an existing regular file and not a symlink or directory`,
    );
  }

  if (charterBytes.byteLength === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `charter file is empty: '${charterPathRaw}'; provide a valid markdown charter per CONTRACTS.md §7`,
    );
  }

  let charterText: string;
  try {
    charterText = new TextDecoder("utf-8", { fatal: true }).decode(charterBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HarnessError("INVALID_ARGUMENT", `charter file contains invalid UTF-8: ${message}`);
  }

  const parsedCharter: ParsedCharter = parseCharter(charterText);

  const generationFlag = integerFlag(flags, "generation", { minimum: 1 });
  const mindIdFlag = textFlag(flags, "mind-id", false);

  let generation: number;
  let mindId: string;

  if (generationFlag !== undefined) {
    generation = generationFlag;
    mindId = mindIdFlag ?? `mind-gen-${generation}`;
  } else if (mindIdFlag !== undefined) {
    mindId = mindIdFlag;
    const match = /mind-gen-(\d+)/.exec(mindId);
    generation = match ? parseInt(match[1]!, 10) : 1;
  } else {
    generation = 1;
    mindId = "mind-gen-1";
  }

  const actor = textFlag(flags, "actor", false) ?? "owner";

  const relativeCharterPath = relative(repoRoot, resolvedCharterPath) || charterPathRaw;

  const targetCapsuleDir = join(resolveCapsulesDir(repoRoot), mindId);
  if (existsSync(targetCapsuleDir)) {
    throw new HarnessError(
      "INVALID_STATE",
      `capsule already exists at ${targetCapsuleDir}; cannot re-initialize an existing mind capsule`,
    );
  }

  const runRoot = initRun(repoRoot, mindId, charterBytes, "file", true);
  const loaded = loadRun(runRoot);
  const pinnedDigest = loaded.manifest.prompt_sha256;

  const dayKey = new Date().toISOString().slice(0, 10);
  const budgets = parsedCharter.budgets;

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
        opened_at: new Date().toISOString(),
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

      const nowIso = new Date().toISOString();
      const initialGrants: AgentGrantRecord[] = [
        {
          id: mindId,
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "initialization",
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
          host: "initialization",
          granted_at: nowIso,
          status: "active",
        });
      }

      writeAgentLedger(state, initialGrants);

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
  };
}
