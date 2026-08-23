import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import {
  createInternalCommandRunner,
  type InternalCommandRunner,
} from "./internal-command-runner.ts";
import { runAttempt } from "./run-attempt.ts";
import type { CommandOptions, CommandResult, PreparedCommand } from "./types.ts";
import { readAgentMetadata } from "../../runtime/agent-metadata.ts";
import { verifyCommandAuthorization } from "../../policy/rbac-engine.ts";
import { resolveScratchDir } from "../../core/shared/paths.ts";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const authoritativeRunner = createInternalCommandRunner({
  inspectRepository: inspectRepositoryBinding,
  attempt: runAttempt,
});

// `runner` is an injection seam for tests only: every production caller invokes these with a
// single argument, so it always resolves to the real, repository/process-backed runner above.

import {
  readFileSync as _readFileSync,
  writeFileSync as _writeFileSync,
  rmSync as _rmSync,
  existsSync as _existsSync,
  mkdirSync as _mkdirSync,
} from "node:fs";

function isBroadScopeTest(argv: string[]): boolean {
  if (argv.length === 0) return false;
  const executable = argv[0];
  if (
    !executable ||
    !["bun", "npm", "pytest", "cargo", "vitest", "pnpm", "yarn"].includes(executable)
  ) {
    return false;
  }
  const isTestOrBuild =
    argv.includes("test") ||
    argv.includes("build") ||
    executable === "pytest" ||
    executable === "vitest";
  if (!isTestOrBuild) return false;

  const hasFilePath = argv
    .slice(1)
    .some(
      (arg) =>
        !arg.startsWith("-") &&
        arg !== "test" &&
        arg !== "build" &&
        arg !== "run" &&
        (arg.includes(".") || arg.includes("/")),
    );
  return !hasFilePath;
}

function acquireMutexLock(repositoryRoot: string, argv: string[]) {
  if (!isBroadScopeTest(argv)) return () => {};

  const lockDir = join(repositoryRoot, ".olt", ".locks");
  if (!_existsSync(lockDir)) {
    _mkdirSync(lockDir, { recursive: true });
  }

  const lockFile = join(lockDir, "execution.lock");
  if (_existsSync(lockFile)) {
    try {
      const pidStr = _readFileSync(lockFile, "utf-8");
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid)) {
        let isAlive = false;
        try {
          process.kill(pid, 0);
          isAlive = true;
        } catch (e) {
          // dead
        }
        if (isAlive && pid !== process.pid) {
          throw new Error(
            `[ENGINE_MUTEX_LOCKED] Concurrent duplicate broad run blocked. PID ${pid} is already executing a broad command.`,
          );
        }
      }
    } catch (e: any) {
      if (e.message?.includes("[ENGINE_MUTEX_LOCKED]")) throw e;
    }
  }

  _writeFileSync(lockFile, process.pid.toString());

  let released = false;
  const cleanup = () => {
    if (released) return;
    released = true;
    try {
      if (_existsSync(lockFile)) {
        const pidStr = _readFileSync(lockFile, "utf-8");
        if (parseInt(pidStr, 10) === process.pid) {
          _rmSync(lockFile, { force: true });
        }
      }
    } catch {}
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return cleanup;
}

export async function prepareCommand(
  input: CommandOptions,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<PreparedCommand> {
  const repoRoot = input.repositoryRoot || process.cwd();
  let timeoutMs = 30000;
  try {
    const policyPath = join(repoRoot, ".olt", "policy.json");
    if (_existsSync(policyPath)) {
      const policyContent = _readFileSync(policyPath, "utf-8");
      const policy = JSON.parse(policyContent);
      if (typeof policy.timeout_ms === "number") {
        timeoutMs = policy.timeout_ms;
      }
    }
  } catch (e) {}
  input.wallTimeoutMs = input.wallTimeoutMs ?? timeoutMs;

  const prepared = await runner.prepareCommand(input);

  // Verify Authorization
  const metadata = readAgentMetadata(input.actor, prepared.options.runRoot);
  if (!metadata) {
    throw new Error(
      `[ROLE_BOUNDARY_VIOLATION] Cannot find AgentMetadata for actor: ${input.actor}`,
    );
  }

  const auth = verifyCommandAuthorization(metadata, input.argv);
  if (!auth.authorized) {
    throw new Error(auth.message || `[${auth.error_code}] Command authorization failed`);
  }

  // Emit signed receipt to .olt/scratch/evidence/
  const scratchDir = resolveScratchDir(prepared.options.repositoryRoot);
  const evidenceDir = join(scratchDir, "evidence");
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  const receipt = {
    actor: metadata.agent_id,
    role: metadata.role,
    command: input.argv.join(" "),
    timestamp: new Date().toISOString(),
    authorized: true,
  };

  const receiptStr = JSON.stringify(receipt, null, 2);
  const digest = createHash("sha256").update(receiptStr).digest("hex");
  writeFileSync(join(evidenceDir, `${digest}.json`), receiptStr);

  return prepared;
}

export async function executePreparedCommand(
  prepared: PreparedCommand,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<CommandResult> {
  const cleanup = acquireMutexLock(prepared.options.repositoryRoot, prepared.options.argv);
  try {
    return await runner.executePreparedCommand(prepared);
  } finally {
    cleanup();
  }
}
