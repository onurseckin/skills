import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonObject } from "../../../core/contracts/index.ts";
import { atomicWriteJson } from "../../../core/durable-write.ts";
import { readRegularFileNoFollow } from "../../../core/no-follow.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { loadRun, transact } from "../../../engine/store/index.ts";
import {
  DEFAULT_CHARTER_RELATIVE_PATH,
  parseCharter,
  resolveCharterPath,
  type ParsedCharter,
} from "../../lifecycle/charter/index.ts";
import { finishRotation } from "./finisher.ts";
import type { RotateMindOptions, RotateMindResult } from "./types.ts";

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

  const sourceGeneration = typeof sourceMind.generation === "number" ? sourceMind.generation : 1;
  const targetGeneration = sourceGeneration + 1;
  const sourceRunId = sourceLoaded.manifest.run_id || basename(realSourceRunRoot);

  const capsulesParent = options.capsulesDir
    ? resolve(options.capsulesDir)
    : dirname(realSourceRunRoot);
  const repoRoot =
    basename(capsulesParent) === "capsules" && basename(dirname(capsulesParent)) === ".olt"
      ? dirname(dirname(capsulesParent))
      : dirname(capsulesParent);

  const sourceCharter = (sourceMind.charter ?? {}) as Record<string, unknown>;
  const declaredCharterSourcePath =
    typeof sourceCharter.source_path === "string"
      ? sourceCharter.source_path
      : DEFAULT_CHARTER_RELATIVE_PATH;
  const declaredCharterRepoRoots = Array.isArray(sourceCharter.repo_roots)
    ? (sourceCharter.repo_roots as readonly unknown[]).filter(
        (entry): entry is string => typeof entry === "string",
      )
    : undefined;

  const liveCharterPath = resolveCharterPath(
    repoRoot,
    declaredCharterSourcePath,
    declaredCharterRepoRoots,
  );

  let promptBytes: Uint8Array;
  try {
    promptBytes = readRegularFileNoFollow(liveCharterPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HarnessError(
      "INTEGRITY",
      `cannot read live charter at ${liveCharterPath} for generational rotation: ${message}`,
    );
  }

  if (promptBytes.byteLength === 0) {
    throw new HarnessError(
      "INTEGRITY",
      `live charter at ${liveCharterPath} is empty; refusing to rotate onto an empty charter`,
    );
  }

  let parsedCharter: ParsedCharter;
  try {
    parsedCharter = parseCharter(new TextDecoder("utf-8", { fatal: true }).decode(promptBytes));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HarnessError(
      "INTEGRITY",
      `live charter at ${liveCharterPath} is not a parseable mind manifest: ${message}`,
    );
  }

  const charterSourcePath = relative(repoRoot, liveCharterPath) || declaredCharterSourcePath;
  const charterGoals: readonly string[] = parsedCharter.goalIds;
  const charterRepoRoots: readonly string[] = parsedCharter.repoRoots;

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
  const nowMs =
    options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "number"
        ? options.now
        : typeof options.now === "string"
          ? Date.parse(options.now)
          : Date.now();
  if (options.now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${options.now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

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

  return finishRotation({
    repoRoot,
    targetRunId,
    promptBytes,
    parsedCharter,
    liveCharterPath,
    sourceRunId,
    realSourceRunRoot,
    sourceGeneration,
    targetGeneration,
    sourceState,
    capsulesParent,
    actor,
    nowIso,
    previousEventHead,
    charterSourcePath,
    charterGoals,
    charterRepoRoots,
    sourceLoaded,
  });
}
