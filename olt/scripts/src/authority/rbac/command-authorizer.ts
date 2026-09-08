import { spawn } from "node:child_process";
import { acquireTestLock, type TestLockOptions } from "../../../../../scripts/testing/index.ts";
import {
  inferActorRole,
  inspectShellEval,
  isAnyTestRun,
  isCoordinatorRole,
  isFileMutationCommand,
  isSupervisorOrValidatorRole,
  isUnauthorizedGitMutation,
  isWholeSuiteTestRun,
} from "./command-predicates.ts";

export interface CommandAuthResult {
  readonly authorized: boolean;
  readonly reason?: string | undefined;
  readonly actorRole: string;
  readonly cmd: readonly string[];
}

export interface CommandExecResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly authorized: boolean;
  readonly reason?: string | undefined;
}

export interface ShieldedCommandOptions {
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly actorRole?: string | undefined;
  readonly enforceConcurrencyLock?: boolean | undefined;
  readonly lockOptions?: TestLockOptions | undefined;
}

export function acquireBroadTestLock(
  cmd: readonly string[],
  options?: TestLockOptions,
): () => void {
  const isBroad = isWholeSuiteTestRun(cmd);
  return acquireTestLock(isBroad, cmd, options);
}

export async function guardBroadTestExecution<T>(
  cmd: readonly string[],
  action: () => Promise<T> | T,
  options?: TestLockOptions,
): Promise<{ executed: boolean; result?: T | undefined; bypassedLock: boolean }> {
  const isBroad = isWholeSuiteTestRun(cmd);
  if (!isBroad) {
    return { executed: true, result: await action(), bypassedLock: true };
  }
  const releaseLock = acquireTestLock(true, cmd, options);
  try {
    return { executed: true, result: await action(), bypassedLock: false };
  } finally {
    releaseLock();
  }
}

export function verifyCommandAuthorization(
  actorRole: string,
  cmd: readonly string[],
): CommandAuthResult {
  if (cmd.length === 0) return { authorized: false, reason: "EMPTY_COMMAND", actorRole, cmd };
  const indirect = inspectShellEval(actorRole, cmd, (r, c) => verifyCommandAuthorization(r, c));
  if (indirect !== null && !indirect.authorized) {
    return { authorized: false, reason: indirect.reason, actorRole, cmd };
  }

  if (isWholeSuiteTestRun(cmd)) {
    return { authorized: false, reason: "WHOLE_SUITE_TEST_RUN_DENIED", actorRole, cmd };
  }
  if (isUnauthorizedGitMutation(cmd)) {
    return { authorized: false, reason: "UNAUTHORIZED_GIT_MUTATION", actorRole, cmd };
  }
  if (isSupervisorOrValidatorRole(actorRole)) {
    if (isAnyTestRun(cmd)) {
      return { authorized: false, reason: "SUPERVISOR_ZERO_TEST_RUNS", actorRole, cmd };
    }
    if (isFileMutationCommand(cmd)) {
      const reason = isCoordinatorRole(actorRole)
        ? "ROLE_BOUNDARY_DEVIATION"
        : "SUPERVISOR_ZERO_CODE_EDITS";
      return { authorized: false, reason, actorRole, cmd };
    }
  }
  return { authorized: true, actorRole, cmd };
}

export async function executeShieldedCommand(
  actorId: string,
  cmd: readonly string[],
  options: ShieldedCommandOptions = {},
): Promise<CommandExecResult> {
  const role = options.actorRole ?? inferActorRole(actorId);
  const auth = verifyCommandAuthorization(role, cmd);
  if (!auth.authorized) {
    const errText = auth.reason !== undefined ? auth.reason : "";
    return {
      success: false,
      stdout: "",
      stderr: errText,
      exitCode: 1,
      authorized: false,
      reason: auth.reason,
    };
  }

  let releaseLock: (() => void) | undefined;
  if (options.enforceConcurrencyLock || isAnyTestRun(cmd)) {
    releaseLock = acquireBroadTestLock(cmd, options.lockOptions);
  }

  return new Promise((resolvePromise) => {
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (releaseLock) {
        try {
          releaseLock();
        } catch {}
        releaseLock = undefined;
      }
    };

    const firstArg = cmd[0] ?? "";
    const restArgs = cmd.slice(1);
    const proc = spawn(firstArg, restArgs, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    if (proc.stdout) {
      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString("utf8");
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
    }
    proc.on("error", (err: Error) => {
      cleanup();
      resolvePromise({
        success: false,
        stdout,
        stderr: err.message,
        exitCode: 1,
        authorized: true,
        reason: err.message,
      });
    });
    proc.on("close", (code: number | null) => {
      cleanup();
      const exitCode = code !== null ? code : 1;
      resolvePromise({ success: exitCode === 0, stdout, stderr, exitCode, authorized: true });
    });
  });
}
