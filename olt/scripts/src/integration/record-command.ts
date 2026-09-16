import { existsSync } from "node:fs";
import { dirname, posix } from "node:path";
import type { CommandAttemptStartedRecord, CommandRecord } from "../core/contracts/index.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import { atomicWriteJson } from "../core/index.ts";
import { readCanonicalObject } from "../core/json.ts";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import { MAX_COMMAND_RECORD_BYTES } from "../engine/runner/models/command/index.ts";
import { executePreparedCommand, prepareCommand } from "../engine/runner/models/execution/index.ts";
import { resolveArtifactPath } from "../engine/runner/core/artifact-paths.ts";
import {
  assertCommandActor,
  assertCommandArgv,
  assertCommandIdentities,
} from "../engine/runner/core/policy.ts";
import type { CommandOptions, CommandResult } from "../engine/runner/types/types.ts";
import { verifyCommandRecord } from "../engine/runner/signing/verify-command.ts";
import { gateControlBindingsOverlapWriteScopes } from "../engine/runner/signing/gate-path-overlap.ts";

import { loadRun, transact } from "../engine/store/index.ts";
import {
  recoverAggregateFromAttempts,
  type AttemptReconciliationDependencies,
} from "./reconcile-command-attempts.ts";
import { sameIntent, sameOptionalJson, sameRepositoryTransition } from "./command-intent-match.ts";

export { sameIntent, sameOptionalJson, sameRepositoryTransition };

interface RunAndRecordDependencies {
  prepare: typeof prepareCommand;
  execute: typeof executePreparedCommand;
  reconcile: typeof reconcileStrandedCommands;
}

const commandDependencies: RunAndRecordDependencies = {
  prepare: prepareCommand,
  execute: executePreparedCommand,
  reconcile: reconcileStrandedCommands,
};

function assertVerified(runRoot: string, record: CommandRecord): void {
  const issues = verifyCommandRecord(runRoot, record);
  if (issues.length > 0) {
    throw new HarnessError("INTEGRITY", `command evidence is invalid: ${issues.join("; ")}`);
  }
}

function assertActor(actor: string, record: CommandRecord): void {
  if (actor !== record.actor)
    throw new HarnessError("INVALID_STATE", "command event actor does not match command actor");
}

function commandsIn(draft: Record<string, unknown>): JsonObject {
  return (draft.commands ?? {}) as JsonObject;
}

export function recordCommandIntent(runRoot: string, actor: string, record: CommandRecord): void {
  assertCommandActor(actor);
  if (record.status !== "running")
    throw new HarnessError("INVALID_STATE", "command intent must be running");
  assertVerified(runRoot, record);
  assertActor(actor, record);
  transact(runRoot, actor, "command-intent-recorded", { command_id: record.id }, (draft) => {
    const commands = commandsIn(draft);
    const tasks = (draft.tasks ?? {}) as Record<string, { write_scope: string[] }>;
    if (
      gateControlBindingsOverlapWriteScopes(
        record.path_bindings ?? [],
        Object.values(tasks).map((task) => task.write_scope),
      )
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        "repo-local gate control input overlaps a task mutable write scope",
      );
    }
    if (commands[record.id] !== undefined)
      throw new HarnessError("INVALID_STATE", `command is already registered: ${record.id}`);
    commands[record.id] = structuredClone(record);
    draft.commands = commands;
  });
}

export function reconcileCommandResult(
  runRoot: string,
  actor: string,
  record: CommandRecord,
): void {
  assertCommandActor(actor);
  if (record.status === "running")
    throw new HarnessError("INVALID_STATE", "cannot reconcile a running command");
  assertVerified(runRoot, record);
  assertActor(actor, record);
  transact(
    runRoot,
    actor,
    "command-reconciled",
    { command_id: record.id, status: record.status },
    (draft) => {
      const commands = commandsIn(draft);
      const intent = commands[record.id] as unknown as CommandRecord | undefined;
      if (!intent || intent.status !== "running" || !sameIntent(intent, record)) {
        throw new HarnessError("INVALID_STATE", "terminal command does not match its intent");
      }
      commands[record.id] = structuredClone(record);
      draft.commands = commands;
    },
  );
}

function isPidLive(pid: number): "live" | "absent" {
  try {
    process.kill(pid, 0);
    return "live";
  } catch {
    return "absent";
  }
}

function hasActiveAttemptProcess(
  runRoot: string,
  intent: CommandRecord,
  probeProcess?: AttemptReconciliationDependencies["probeProcess"],
): boolean {
  const commandDirectory = posix.dirname(intent.record_path);
  const maximum = (intent.policy?.max_retries ?? 0) + 1;
  for (let index = 0; index < maximum; index += 1) {
    const base = `${commandDirectory}/attempt-${index + 1}`;
    const directory = resolveArtifactPath(runRoot, base);
    const startedPath = `${directory}/attempt-started.json`;
    const recordPath = `${directory}/record.json`;
    if (existsSync(recordPath)) continue;
    if (existsSync(startedPath)) {
      try {
        const started = readCanonicalObject(startedPath, `command ${intent.id} attempt started`, {
          maxBytes: 16 * 1024,
          maxDepth: 8,
        }) as unknown as CommandAttemptStartedRecord;
        if (started.root_pid_identity) {
          const proof = probeProcess
            ? probeProcess(
                started.root_pid_identity as Parameters<
                  AttemptReconciliationDependencies["probeProcess"]
                >[0],
              )
            : isPidLive(started.root_pid_identity.pid);
          if (proof === "live") return true;
        }
      } catch {
        // unreadable started marker
      }
    }
  }
  return false;
}

export function reconcileStrandedCommands(
  runRoot: string,
  actor: string,
  injected: Partial<AttemptReconciliationDependencies & { gracePeriodMs?: number }> = {},
): { reconciled: string[]; stranded: string[] } {
  assertCommandActor(actor);
  const commands = (loadRun(runRoot).state.commands ?? {}) as Record<string, CommandRecord>;
  const reconciled: string[] = [];
  const stranded: string[] = [];
  for (const intent of Object.values(commands).filter((record) => record.status === "running")) {
    const stored = readCanonicalObject(
      resolveArtifactPath(runRoot, intent.record_path),
      `command ${intent.id} aggregate record`,
      { maxBytes: MAX_COMMAND_RECORD_BYTES, maxDepth: 64 },
    ) as unknown as CommandRecord;
    if (stored.status === "running" || stored.retry_pending) {
      let recovered: CommandRecord | undefined;
      try {
        recovered = recoverAggregateFromAttempts(runRoot, intent, injected);
      } catch {
        recovered = undefined;
      }
      if (!recovered) {
        const probe = injected.probeProcess;
        const nowFn = injected.now ?? (() => new Date());
        const gracePeriodMs = injected.gracePeriodMs ?? 5_000;
        const startedAt = Date.parse(intent.started_at);
        const isExpired =
          Number.isFinite(startedAt) && nowFn().getTime() - startedAt >= gracePeriodMs;
        const isActive = hasActiveAttemptProcess(runRoot, intent, probe);

        if (!isActive && isExpired) {
          const finishedAt = nowFn().toISOString();
          const failedRecord: CommandRecord = {
            ...intent,
            status: "failed",
            finished_at: finishedAt,
            exit_code: 1,
            signal: null,
            timeout_kind: null,
            signals_sent: [],
            failure_class: "interrupted_or_lost",
            evidence_error: "interrupted_or_lost",
            ...(intent.gate_id !== null
              ? { preflight_failure: "interrupted_or_lost", repository_after: null }
              : {}),
            attempts: [],
          };
          atomicWriteJson(resolveArtifactPath(runRoot, intent.record_path), failedRecord, 0o600);
          reconcileCommandResult(runRoot, actor, failedRecord);
          reconciled.push(intent.id);
          continue;
        }

        stranded.push(intent.id);
        continue;
      }
      reconcileCommandResult(runRoot, actor, recovered);
      reconciled.push(intent.id);
      continue;
    }
    reconcileCommandResult(runRoot, actor, stored);
    reconciled.push(intent.id);
  }
  return { reconciled, stranded };
}

export async function runAndRecordCommand(
  runRoot: string,
  options: CommandOptions,
  injected: Partial<RunAndRecordDependencies> = {},
): Promise<CommandResult> {
  const dependencies = { ...commandDependencies, ...injected };
  assertCommandArgv(options.argv);
  assertCommandIdentities(options);
  const recovery = dependencies.reconcile(runRoot, options.actor);
  if (recovery.stranded.length > 0)
    throw new HarnessError(
      "INVALID_STATE",
      `running command intents lack terminal evidence: ${recovery.stranded.join(", ")}`,
    );
  const prepared = await dependencies.prepare({
    ...options,
    runRoot,
    repositoryRoot: options.repositoryRoot ?? findRepoRoot(runRoot),
  });
  recordCommandIntent(runRoot, options.actor, prepared.record);
  try {
    const result = await dependencies.execute(prepared);
    reconcileCommandResult(runRoot, options.actor, result.record);
    return result;
  } catch (error) {
    dependencies.reconcile(runRoot, options.actor);
    throw error;
  }
}
