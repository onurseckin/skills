import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { JsonObject, JsonValue } from "../contracts/json.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { chainCapsules } from "../orchestrator/capsule-chainer.ts";
import { initRun, loadRun } from "../store/index.ts";
import { transact } from "../store/transaction.ts";
import { DEFAULT_MIND_BUDGET } from "./charter.ts";
import type { CandidateRecord } from "./gates.ts";

export interface RotateMindOptions {
  readonly sourceRunRoot: string;
  readonly nextRunId?: string | undefined;
  readonly nextRunRoot?: string | undefined;
  readonly actor?: string | undefined;
  readonly now?: string | undefined;
  readonly capsulesDir?: string | undefined;
}

export interface RotateMindResult {
  readonly sourceRunRoot: string;
  readonly sourceRunId: string;
  readonly targetRunRoot: string;
  readonly targetRunId: string;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly charterSha256: string;
  readonly charterSourcePath: string;
  readonly previousEventHead: string | null;
  readonly pulseCounter: number;
  readonly carriedCandidates: readonly CandidateRecord[];
  readonly openCandidatesCount: number;
  readonly declinedCandidatesCount: number;
  readonly rotatedAt: string;
}

/**
 * Executes generational rotation from Mind generation N to N+1 per PHASE-6 §3.3 and CONTRACTS.md §1.6.
 *
 * 1. Validates and seals Generation N with status 'rotated' and event 'mind-rotated'.
 * 2. Initializes Generation N+1 carrying forward:
 *    - Charter source path and pinned SHA-256
 *    - All open and admitted candidates
 *    - All declined candidate records (preserving Gate 6 duplicate rejection across generations)
 *    - Pulse counter and budget day key / usage state
 *    - previousEventHead pointing to Generation N's final sealed event head
 */
export function rotateMindGeneration(options: RotateMindOptions): RotateMindResult {
  const { sourceRunRoot } = options;
  if (!sourceRunRoot) {
    throw new HarnessError("INVALID_ARGUMENT", "source run root is required for mind rotation");
  }

  if (!existsSync(sourceRunRoot) || !lstatSync(sourceRunRoot).isDirectory()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `source run root must be an existing directory: ${sourceRunRoot}`,
    );
  }

  if (lstatSync(sourceRunRoot).isSymbolicLink()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `source run root cannot be a symlink: ${sourceRunRoot}`,
    );
  }

  const realSourceRunRoot = realpathSync(sourceRunRoot);
  const sourceLoaded = loadRun(realSourceRunRoot, false);
  const sourceState = sourceLoaded.state as Record<string, unknown>;
  const sourceMind = sourceState.mind as Record<string, unknown> | undefined;

  if (!sourceMind || typeof sourceMind !== "object") {
    throw new HarnessError(
      "INVALID_STATE",
      `source capsule at ${sourceRunRoot} is not a valid mind capsule (missing state.mind)`,
    );
  }

  if (sourceMind.status === "rotated") {
    throw new HarnessError(
      "INVALID_STATE",
      `capsule at ${sourceRunRoot} is already sealed with status 'rotated'`,
    );
  }

  const sourceGeneration =
    typeof sourceMind.generation === "number" ? sourceMind.generation : 1;
  const targetGeneration = sourceGeneration + 1;
  const sourceRunId = sourceLoaded.manifest.run_id || basename(realSourceRunRoot);

  const sourceCharter = (sourceMind.charter ?? {}) as Record<string, unknown>;
  const charterSourcePath =
    typeof sourceCharter.source_path === "string"
      ? sourceCharter.source_path
      : "docs/mind/CHARTER.md";
  const charterGoals = Array.isArray(sourceCharter.goals)
    ? (sourceCharter.goals as readonly string[])
    : [];
  const charterRepoRoots = Array.isArray(sourceCharter.repo_roots)
    ? (sourceCharter.repo_roots as readonly string[])
    : [];

  const sourcePromptPath = join(realSourceRunRoot, "prompt.md");
  let promptBytes: Uint8Array;
  try {
    promptBytes = readRegularFileNoFollow(sourcePromptPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HarnessError(
      "INTEGRITY",
      `cannot read prompt.md in source capsule: ${message}`,
    );
  }

  if (promptBytes.byteLength === 0) {
    throw new HarnessError(
      "INTEGRITY",
      `prompt.md in source capsule is empty: ${sourcePromptPath}`,
    );
  }

  const capsulesParent = options.capsulesDir
    ? resolve(options.capsulesDir)
    : dirname(realSourceRunRoot);
  const repoRoot = dirname(capsulesParent);

  let targetRunId: string;
  let targetRunRoot: string;

  if (options.nextRunRoot) {
    targetRunRoot = isAbsolute(options.nextRunRoot)
      ? options.nextRunRoot
      : resolve(options.nextRunRoot);
    targetRunId = options.nextRunId ?? basename(targetRunRoot);
  } else if (options.nextRunId) {
    targetRunId = options.nextRunId;
    if (targetRunId.includes("/") || targetRunId.includes("\\")) {
      targetRunRoot = resolve(targetRunId);
      targetRunId = basename(targetRunRoot);
    } else {
      targetRunRoot = join(capsulesParent, targetRunId);
    }
  } else {
    targetRunId = `mind-gen-${targetGeneration}`;
    targetRunRoot = join(capsulesParent, targetRunId);
  }

  if (existsSync(targetRunRoot)) {
    throw new HarnessError(
      "INVALID_STATE",
      `capsule already exists at ${targetRunRoot}; cannot rotate into an existing capsule`,
    );
  }

  const actor = options.actor ?? "owner";
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  if (options.now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${options.now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

  // 1. Seal Generation N
  transact(
    realSourceRunRoot,
    actor,
    "mind-rotated",
    {
      status: "rotated",
      next_generation: targetGeneration,
      next_run_id: targetRunId,
      rotated_at: nowIso,
    },
    (state) => {
      const mind = (state.mind ?? {}) as Record<string, unknown>;
      mind.status = "rotated";
      mind.rotated_at = nowIso;
      mind.next_generation = {
        run_id: targetRunId,
        generation: targetGeneration,
        rotated_at: nowIso,
      };
      state.mind = mind as unknown as JsonObject;

      const pulse = (state.pulse ?? {}) as Record<string, unknown>;
      pulse.open = null;
      state.pulse = pulse as unknown as JsonObject;
    },
  );

  const sourcePulse = (sourceState.pulse ?? {}) as Record<string, unknown>;
  const openPulse = sourcePulse.open as Record<string, unknown> | null | undefined;
  const lastPulse = sourcePulse.last as Record<string, unknown> | null | undefined;
  const lastPulseId: string | null =
    (typeof openPulse?.pulse_id === "string" ? openPulse.pulse_id : null) ??
    (typeof lastPulse?.pulse_id === "string" ? lastPulse.pulse_id : null);

  atomicWriteJson(join(realSourceRunRoot, "last_pulse.json"), {
    at: nowIso,
    pulse_id: lastPulseId,
    outcome: "rotated",
    next_wake_at: null,
  });

  const sealedSourceLoaded = loadRun(realSourceRunRoot, false);
  const previousEventHead = sealedSourceLoaded.state.event_head ?? null;

  // 2. Initialize Generation N+1
  const initializedTargetRoot = initRun(repoRoot, targetRunId, promptBytes, "file", true);

  chainCapsules({
    sourceRunId,
    targetRunId,
    sourceCapsulePath: realSourceRunRoot,
    targetCapsulePath: initializedTargetRoot,
    roundNumber: targetGeneration,
  });

  // 3. Prepare carried candidates, budget, and pulse state
  const sourceCandidates = (
    Array.isArray(sourceState.candidates) ? sourceState.candidates : []
  ) as readonly CandidateRecord[];

  const carriedCandidates = sourceCandidates.filter(
    (c) => c.status === "opened" || c.status === "admitted" || c.status === "declined",
  );
  const openCandidatesCount = carriedCandidates.filter(
    (c) => c.status === "opened" || c.status === "admitted",
  ).length;
  const declinedCandidatesCount = carriedCandidates.filter(
    (c) => c.status === "declined",
  ).length;

  const sourcePulseState = (sourceState.pulse ?? {}) as Record<string, unknown>;
  const pulseCounter =
    typeof sourcePulseState.counter === "number" ? sourcePulseState.counter : 0;
  const sourceBudgetState = (sourceState.budget ?? {}) as Record<string, unknown>;

  transact(
    initializedTargetRoot,
    actor,
    "mind-initialized",
    {
      generation: targetGeneration,
      charter_source_path: charterSourcePath,
      pinned_digest: sealedSourceLoaded.manifest.prompt_sha256,
      previous_generation: {
        run_id: sourceRunId,
        event_head: previousEventHead,
        sealed_at: nowIso,
      },
    },
    (state) => {
      state.mind = {
        generation: targetGeneration,
        opened_at: nowIso,
        charter: {
          source_path: charterSourcePath,
          pinned_sha256: sealedSourceLoaded.manifest.prompt_sha256,
          goals: charterGoals,
          repo_roots: charterRepoRoots,
          evidence_class: "harness_observed",
        },
        previous_generation: {
          run_id: sourceRunId,
          event_head: previousEventHead,
          sealed_at: nowIso,
        },
      } as unknown as JsonValue;

      state.budget = {
        pulses_per_day:
          sourceBudgetState.pulses_per_day ?? DEFAULT_MIND_BUDGET.pulses_per_day,
        wall_clock_ms_per_day:
          sourceBudgetState.wall_clock_ms_per_day ?? DEFAULT_MIND_BUDGET.wall_clock_ms_per_day,
        max_agents_in_flight:
          sourceBudgetState.max_agents_in_flight ?? DEFAULT_MIND_BUDGET.max_agents_in_flight,
        max_rounds_per_objective:
          sourceBudgetState.max_rounds_per_objective ??
          DEFAULT_MIND_BUDGET.max_rounds_per_objective,
        base_interval_ms:
          sourceBudgetState.base_interval_ms ?? DEFAULT_MIND_BUDGET.base_interval_ms,
        max_interval_ms:
          sourceBudgetState.max_interval_ms ?? DEFAULT_MIND_BUDGET.max_interval_ms,
        max_pause_interval_ms:
          sourceBudgetState.max_pause_interval_ms ?? DEFAULT_MIND_BUDGET.max_pause_interval_ms,
        pulse_deadline_ms:
          sourceBudgetState.pulse_deadline_ms ?? DEFAULT_MIND_BUDGET.pulse_deadline_ms,
        max_open_proposals:
          sourceBudgetState.max_open_proposals ?? DEFAULT_MIND_BUDGET.max_open_proposals,
        quiet_hours:
          sourceBudgetState.quiet_hours !== undefined
            ? sourceBudgetState.quiet_hours
            : DEFAULT_MIND_BUDGET.quiet_hours,
        day_key: sourceBudgetState.day_key ?? nowIso.slice(0, 10),
        pulses_today: sourceBudgetState.pulses_today ?? 0,
        wall_clock_ms_today: sourceBudgetState.wall_clock_ms_today ?? 0,
      } as unknown as JsonValue;

      state.pulse = {
        counter: pulseCounter,
        open: null,
        last: null,
      } as unknown as JsonValue;

      state.observations = [] as unknown as JsonValue;
      state.candidates = carriedCandidates as unknown as JsonValue;
      state.escalations = [] as unknown as JsonValue;
      state.audit = {
        last_started_at: null,
        last_verdict: null,
        open_findings: [],
      } as unknown as JsonValue;
    },
  );

  atomicWriteJson(join(initializedTargetRoot, "last_pulse.json"), {
    at: nowIso,
    pulse_id: null,
    outcome: null,
    next_wake_at: null,
  });

  return {
    sourceRunRoot: realSourceRunRoot,
    sourceRunId,
    targetRunRoot: initializedTargetRoot,
    targetRunId,
    sourceGeneration,
    targetGeneration,
    charterSha256: sealedSourceLoaded.manifest.prompt_sha256,
    charterSourcePath,
    previousEventHead,
    pulseCounter,
    carriedCandidates,
    openCandidatesCount,
    declinedCandidatesCount,
    rotatedAt: nowIso,
  };
}
