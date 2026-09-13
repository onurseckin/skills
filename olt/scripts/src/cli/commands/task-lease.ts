import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { workflowPort } from "../../integration/index.ts";
import { claimTaskLease, readTaskQueue, readTaskQueueFile } from "../../task/queue/index.ts";
import { resolveTraceContext } from "../../telemetry/index.ts";
import { findAssignedWorktree, readWorktreeLedger } from "../../workflow/worktree/index.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  parseArguments,
  textFlag,
  type CommandContext,
  type Flags,
} from "../index.ts";

const ALLOWED_TASK_LEASE_FLAGS: readonly string[] = [
  "task",
  "task-id",
  "id",
  "agent",
  "agent-id",
  "lease-duration",
  "duration-seconds",
  "duration",
  "queue-path",
  "path",
  "run",
  "json",
  "format",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
];

function isCapsuleRunDirectory(targetPath: string): boolean {
  try {
    return (
      existsSync(join(targetPath, "state.json")) ||
      existsSync(join(targetPath, "index.json")) ||
      existsSync(join(targetPath, "manifest.json"))
    );
  } catch {
    return false;
  }
}

export function taskLeaseCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const taskId =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", false);

  if (!taskId) {
    throw new HarnessError("INVALID_ARGUMENT", "Task ID is required (--task, --task-id, or --id)");
  }

  const rawAgent = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const durationSeconds =
    integerFlag(flags, "lease-duration") ??
    integerFlag(flags, "duration-seconds") ??
    integerFlag(flags, "duration");
  const rawRun = textFlag(flags, "run", false);
  const queuePath = textFlag(flags, "queue-path", false) ?? textFlag(flags, "path", false);
  const isJson = boolFlag(flags, "json") || textFlag(flags, "format", false) === "json";

  const isRunCapsule = rawRun !== undefined && isCapsuleRunDirectory(rawRun);
  const isClaimMode =
    !isRunCapsule &&
    (durationSeconds !== undefined || (rawAgent !== undefined && !rawAgent.startsWith("query")));

  if (isClaimMode) {
    const agentId = rawAgent !== undefined ? rawAgent : "agent-worker";
    const claimPath = queuePath ?? (rawRun && !isRunCapsule ? rawRun : undefined);
    const result = claimTaskLease({
      taskId,
      agentId,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(claimPath !== undefined ? { customPath: claimPath } : {}),
    });

    return {
      task: result.task,
      leaseToken: result.leaseToken,
      token: result.leaseToken,
    };
  }

  let token: string | undefined;
  let expiresInSeconds = 0;
  let status = "unknown";

  if (isRunCapsule && rawRun) {
    const repoRoot = findRepoRoot(rawRun);
    try {
      const state = workflowPort(rawRun).read();
      const task = state.tasks[taskId];
      if (task) {
        status = typeof task.status === "string" ? task.status : "leased";
        if (task.lease) {
          const rawToken = task.lease.token;
          token = typeof rawToken === "string" ? rawToken : undefined;
          if (typeof task.lease.expires_at === "string") {
            const expiry = new Date(task.lease.expires_at).getTime();
            expiresInSeconds = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
          }
        }
      }
    } catch {
      // Fallback if workflowPort fails
    }

    if (!token) {
      const taskTokenFile = join(rawRun, `.lease-token-${taskId}`);
      if (existsSync(taskTokenFile)) {
        try {
          token = readFileSync(taskTokenFile, "utf-8").trim();
        } catch {
          // ignore
        }
      }
    }

    if (!token) {
      try {
        const runState = loadRun(rawRun).state;
        const ledger = readWorktreeLedger(runState);
        const worktree = ledger ? findAssignedWorktree(ledger, taskId) : null;
        if (worktree?.worktreePath) {
          const wtTokenFile = join(worktree.worktreePath, ".lease-token");
          if (existsSync(wtTokenFile)) {
            token = readFileSync(wtTokenFile, "utf-8").trim();
          }
        }
      } catch {
        // ignore
      }
    }

    if (!token && existsSync(join(rawRun, ".lease-token"))) {
      try {
        token = readFileSync(join(rawRun, ".lease-token"), "utf-8").trim();
      } catch {
        // ignore
      }
    }

    if (!token) {
      const cwdToken = join(process.cwd(), ".lease-token");
      if (existsSync(cwdToken)) {
        try {
          token = readFileSync(cwdToken, "utf-8").trim();
        } catch {
          // ignore
        }
      }
    }

    if (!token && repoRoot) {
      const pillarSuffix = taskId.replace(/^lane-/, "");
      const candidateWorktree = join(repoRoot, ".olt", "worktrees", pillarSuffix);
      const candidateToken = join(candidateWorktree, ".lease-token");
      if (existsSync(candidateToken)) {
        try {
          token = readFileSync(candidateToken, "utf-8").trim();
        } catch {
          // ignore
        }
      }
    }
  } else {
    const effectiveQueuePath = queuePath ?? (rawRun && !isRunCapsule ? rawRun : undefined);
    try {
      const queue = readTaskQueue(effectiveQueuePath);
      const queueTask = queue.find((t) => t.id === taskId);
      if (queueTask) {
        status = queueTask.lease ? "leased" : (queueTask.status ?? "unknown");
        token = queueTask.lease?.token;
        const expiresAt = queueTask.lease?.expires_at;
        if (expiresAt) {
          const expiry = new Date(expiresAt).getTime();
          expiresInSeconds = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
        }
      }
    } catch {
      // ignore
    }
  }

  if (!token && status === "unknown") {
    status = "unleased";
  }

  const resultObj = {
    token: token ?? "",
    expires_in_seconds: expiresInSeconds,
    status,
    task_id: taskId,
  };

  const textOutput = [
    `TOKEN=${resultObj.token}`,
    `EXPIRES_IN_SECONDS=${resultObj.expires_in_seconds}`,
    `STATUS=${resultObj.status}`,
  ].join("\n");

  const markdown = isJson ? JSON.stringify(resultObj, null, 2) : textOutput;

  return {
    ...resultObj,
    markdown,
  };
}

export async function executeTaskLease(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["task:lease", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_TASK_LEASE_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = taskLeaseCommand(parsed.flags);
    const isJson =
      boolFlag(parsed.flags, "json") || textFlag(parsed.flags, "format", false) === "json";

    if (isJson) {
      const output = {
        ...result,
        traceContext,
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else if (typeof result.markdown === "string") {
      process.stdout.write(`${result.markdown}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation =
      message.includes("required") ||
      message.includes("invalid") ||
      message.includes("unknown option") ||
      message.includes("INVALID_ARGUMENT") ||
      message.includes("INVARIANT_VIOLATION");
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: message, code: isValidation ? 2 : 1 }, null, 2)}\n`,
    );
    return isValidation ? 2 : 1;
  }
}
