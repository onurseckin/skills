import { dirname } from "node:path";
import type { CommandRecord } from "../core/contracts/index.ts";
import type { JsonObject } from "../core/contracts/index.ts";
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

export function reconcileStrandedCommands(
  runRoot: string,
  actor: string,
  injected: Partial<AttemptReconciliationDependencies> = {},
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
      const recovered = recoverAggregateFromAttempts(runRoot, intent, injected);
      if (!recovered) {
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
