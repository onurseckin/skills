import { relative, sep, join } from "node:path";
import type { CommandRecord } from "../../../core/contracts/index";
import { atomicWriteJson } from "../../../core/durable-write";
import { HarnessError } from "../../../core/errors/index";
import { canonicalCommandFingerprint, commandId } from "./command-id";
import { portableArtifactPath } from "../core/artifact-paths";
import type { CommandRuntimeCapability } from "./command-execution-snapshot";
import { assertCommandIntentSize, assertCommandRecordSize } from "./command-record-size";
import {
  executeInternalPreparedCommand,
  type InternalExecutionDependencies,
} from "../core/execute-internal-command";
import { captureGatePathBindings, executionArgv } from "../signing/gate-path-bindings";
import { TRUSTED_HOST_ASSURANCE } from "../signing/gate-observation";
import { assertRunnerPlatform, reserveCommandRoot } from "../core/platform-policy";
import { assertCommandIdentities, normalizeCommandOptions, policyRecord } from "../core/policy";
import { createCommandSigningCapability } from "../execution/attempt-disposition-capability";
import {
  isGitGateCommand,
  isRestrictedGitGate,
  restrictedGateGitArgv,
} from "../core/restricted-git-gate";
import type { CommandOptions, CommandResult, PreparedCommand } from "../types/types";

export interface InternalCommandRunner {
  prepareCommand(input: CommandOptions): Promise<PreparedCommand>;
  executePreparedCommand(prepared: PreparedCommand): Promise<CommandResult>;
}

function portableCwd(repositoryRoot: string, cwd: string): string {
  const value = relative(repositoryRoot, cwd);
  return value ? value.split(sep).join("/") : ".";
}

function publish(path: string, record: CommandRecord): void {
  assertCommandRecordSize(record);
  atomicWriteJson(path, record, 0o600);
}

export function createInternalCommandRunner(
  dependencies: InternalExecutionDependencies,
): InternalCommandRunner {
  const fixedDependencies = Object.freeze({
    inspectRepository: dependencies.inspectRepository,
    attempt: dependencies.attempt,
  });
  const capabilities = new WeakMap<PreparedCommand, CommandRuntimeCapability>();
  return {
    async prepareCommand(input) {
      assertCommandIdentities(input);
      assertRunnerPlatform();
      const options = await normalizeCommandOptions(input);
      const gate = options.gateId !== undefined && options.gateId !== null;
      if (gate && isGitGateCommand(options.argv) && !isRestrictedGitGate(options.argv))
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "gate command is not an accepted verification command",
        );
      const attemptSigner =
        dependencies.createCommandSigner?.() ?? createCommandSigningCapability();
      const previewId = commandId();
      let recordPath = join(options.commandDir, previewId, "record.json");
      const pathBindings = gate
        ? captureGatePathBindings(
            options.repositoryRoot,
            options.cwd,
            options.argv,
            options.environment.PATH,
          )
        : undefined;
      const restrictedGitExecution =
        pathBindings && isRestrictedGitGate(options.argv)
          ? restrictedGateGitArgv(executionArgv(options.argv, pathBindings))
          : undefined;
      const record: CommandRecord = {
        id: previewId,
        argv: [...options.argv],
        ...(restrictedGitExecution ? { execution_argv: restrictedGitExecution } : {}),
        cwd: options.cwd,
        cwd_relative: portableCwd(options.repositoryRoot, options.cwd),
        repository_root: options.repositoryRoot,
        status: "running",
        task_id: options.taskId ?? null,
        gate_id: options.gateId ?? null,
        started_at: new Date().toISOString(),
        finished_at: null,
        exit_code: null,
        signal: null,
        fingerprint: canonicalCommandFingerprint(options.cwd, options.argv),
        attempt_signing_public_key: attemptSigner.verificationPublicKey,
        record_path: portableArtifactPath(options.runRoot, recordPath),
        actor: options.actor,
        ...(options.toolCategory === undefined ? {} : { tool_category: options.toolCategory }),
        ...(options.tool === undefined ? {} : { tool: options.tool }),
        ...(options.toolExtras === undefined ? {} : { tool_extras: { ...options.toolExtras } }),
        timeout_kind: null,
        signals_sent: [],
        policy: policyRecord(options),
        attempts: [],
        retry_exhausted: false,
        environment: structuredClone(options.environment),
        ...(gate
          ? {
              assurance: TRUSTED_HOST_ASSURANCE,
              repository_before: structuredClone(
                fixedDependencies.inspectRepository(options.repositoryRoot),
              ),
              repository_after: null,
              path_bindings: pathBindings!,
            }
          : {}),
      };
      assertCommandIntentSize(record);
      const reserved = await reserveCommandRoot(options.commandDir);
      record.id = reserved.id;
      recordPath = join(reserved.path, "record.json");
      record.record_path = portableArtifactPath(options.runRoot, recordPath);
      publish(recordPath, record);
      const prepared = { options, record, commandRoot: reserved.path, recordPath };
      capabilities.set(
        prepared,
        Object.freeze({
          commandRoot: reserved.path,
          recordPath,
          commandDir: options.commandDir,
          runRoot: options.runRoot,
          attemptSigner,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.pump === undefined ? {} : { pump: options.pump }),
        }),
      );
      return prepared;
    },
    async executePreparedCommand(prepared) {
      const capability = capabilities.get(prepared);
      if (!capability)
        throw new Error("prepared command does not belong to this internal runner capability");
      return executeInternalPreparedCommand(prepared, capability, fixedDependencies);
    },
  };
}
