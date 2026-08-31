import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { actorFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { loadRepoPolicy } from "../../policy/repo-policy.ts";
import { verifyCommandAuthorization } from "../../policy/index.ts";
import { readAgentMetadata } from "../../runtime/index.ts";
import { emitTelemetryEvent } from "../../reporting/telemetry-stream.ts";
import { findRepoRoot, resolveEvidenceDir, resolveScratchDir } from "../../core/shared/paths.ts";
import { runExecCommand } from "./run-ops.ts";
import type { CommandRecord } from "../../core/contracts/index.ts";

export interface ShellExecutionResult {
  readonly markdown: string;
  readonly command: string;
  readonly argv: readonly string[];
  readonly exit_code: number | null;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly receipt_sha256: string;
  readonly evidence_path?: string | undefined;
  readonly duration_ms: number;
  readonly [key: string]: unknown;
}

interface ShellCommandDependencies {
  readonly runExecCommand: typeof runExecCommand;
  readonly existsSync: typeof existsSync;
  readonly mkdirSync: typeof mkdirSync;
  readonly openSync: typeof openSync;
  readonly writeSync: typeof writeSync;
  readonly fsyncSync: typeof fsyncSync;
  readonly closeSync: typeof closeSync;
  readonly renameSync: typeof renameSync;
  readonly unlinkSync: typeof unlinkSync;
  readonly resolveEvidenceDir: typeof resolveEvidenceDir;
}

const defaultShellCommandDependencies: ShellCommandDependencies = {
  runExecCommand,
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  resolveEvidenceDir,
};

let shellCommandDependencies = defaultShellCommandDependencies;

export function setShellCommandDependenciesForTesting(
  injected: Partial<ShellCommandDependencies>,
): () => void {
  const previous = shellCommandDependencies;
  shellCommandDependencies = { ...defaultShellCommandDependencies, ...injected };
  return () => {
    shellCommandDependencies = previous;
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function persistStandaloneReceipt(
  evidenceDir: string,
  receiptPath: string,
  receiptBody: string,
): void {
  const dependencies = shellCommandDependencies;
  const temporaryReceiptPath = join(evidenceDir, `.shell-receipt-${randomUUID()}.tmp`);
  let receiptFd: number | undefined;
  let evidenceDirFd: number | undefined;
  let renamed = false;

  try {
    receiptFd = dependencies.openSync(temporaryReceiptPath, "wx", 0o600);
    const receiptBytes = Buffer.from(receiptBody, "utf-8");
    let written = 0;
    while (written < receiptBytes.length) {
      const bytesWritten = dependencies.writeSync(
        receiptFd,
        receiptBytes,
        written,
        receiptBytes.length - written,
        written,
      );
      if (bytesWritten <= 0) {
        throw new HarnessError("INTEGRITY", "receipt persistence made no forward write progress");
      }
      written += bytesWritten;
    }
    dependencies.fsyncSync(receiptFd);
    dependencies.closeSync(receiptFd);
    receiptFd = undefined;

    dependencies.renameSync(temporaryReceiptPath, receiptPath);
    renamed = true;

    evidenceDirFd = dependencies.openSync(evidenceDir, "r");
    dependencies.fsyncSync(evidenceDirFd);
    dependencies.closeSync(evidenceDirFd);
    evidenceDirFd = undefined;

    if (!dependencies.existsSync(receiptPath)) {
      throw new HarnessError(
        "INTEGRITY",
        "atomic receipt rename did not produce its final evidence path",
      );
    }
  } catch (error) {
    if (receiptFd !== undefined) {
      try {
        dependencies.closeSync(receiptFd);
      } catch {
        // The original persistence error remains the authoritative failure.
      }
    }
    if (evidenceDirFd !== undefined) {
      try {
        dependencies.closeSync(evidenceDirFd);
      } catch {
        // The original persistence error remains the authoritative failure.
      }
    }

    if (!renamed) {
      let cleanupFailure = "";
      try {
        if (dependencies.existsSync(temporaryReceiptPath)) {
          dependencies.unlinkSync(temporaryReceiptPath);
        }
      } catch (cleanupError) {
        cleanupFailure = `; temporary receipt cleanup failed: ${failureMessage(cleanupError)}`;
      }
      throw new HarnessError(
        "INTEGRITY",
        `receipt persistence failed before atomic rename: ${failureMessage(error)}${cleanupFailure}`,
      );
    }

    throw new HarnessError(
      "INTEGRITY",
      `receipt persistence outcome uncertain after atomic rename: ${failureMessage(error)}`,
    );
  }
}

export async function shellCommand(
  flags: Flags,
  _context: CommandContext = {},
  remainder: readonly string[] = [],
): Promise<ShellExecutionResult> {
  const actor = actorFlag(flags);
  const run = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  const task = textFlag(flags, "task", false);
  const wave = integerFlag(flags, "wave", { required: false });
  const gate = textFlag(flags, "gate", false);
  const rawCwd = textFlag(flags, "cwd", false);
  const cwd = rawCwd ?? process.cwd();
  const explicitRole = textFlag(flags, "role", false);

  if (!remainder || remainder.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "shell command requires an executable command following '--'",
    );
  }

  if (gate && (!run || !task)) {
    throw new HarnessError("INVALID_ARGUMENT", "--gate requires both --run and --task");
  }

  const loaded = run ? loadRun(run) : undefined;

  // A capsule command must use the canonical run:exec lifecycle.  Besides
  // durable command evidence, that path owns gate preflight, attachment, and
  // conditional task completion; shell must not duplicate any of those writes.
  if (loaded) {
    const runMetadata =
      explicitRole === undefined ? undefined : readAgentMetadata(actor, loaded.runRoot);
    if (runMetadata && explicitRole !== runMetadata.role) {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `[ROLE_ASSERTION_MISMATCH] --role '${explicitRole}' does not match durable role '${runMetadata.role}'.`,
      );
    }
    const runResult = await shellCommandDependencies.runExecCommand(
      { ...flags, run: loaded.runRoot, ...(rawCwd === undefined ? {} : { cwd: rawCwd }) },
      _context,
      remainder,
    );
    const record = runResult.command as unknown as CommandRecord;
    const logs = record.logs;
    if (!logs) {
      throw new HarnessError("INTEGRITY", `command ${record.id} has no canonical log metadata`);
    }
    const evidencePath = runResult.evidence_path;
    if (typeof evidencePath !== "string" || !shellCommandDependencies.existsSync(evidencePath)) {
      throw new HarnessError("INTEGRITY", `command ${record.id} has no durable canonical evidence`);
    }

    const durationMs =
      record.finished_at === null
        ? 0
        : Math.max(0, Date.parse(record.finished_at) - Date.parse(record.started_at));
    const receiptPayload = {
      actor,
      argv: remainder,
      exit_code: record.exit_code,
      started_at: record.started_at,
      finished_at: record.finished_at,
      duration_ms: durationMs,
      status: record.status,
      command_id: record.id,
      stdout_sha256: logs.stdout.sha256,
      stderr_sha256: logs.stderr.sha256,
    };
    const receiptSha256 = createHash("sha256").update(JSON.stringify(receiptPayload)).digest("hex");

    return {
      markdown: runResult.markdown as string,
      command: remainder.join(" "),
      argv: remainder,
      exit_code: record.exit_code,
      receipt_sha256: receiptSha256,
      evidence_path: evidencePath,
      duration_ms: durationMs,
      stdout_sha256: logs.stdout.sha256,
      stderr_sha256: logs.stderr.sha256,
      command_id: record.id,
      evidence: runResult.evidence,
    };
  }

  const repoRoot = findRepoRoot(cwd);
  const metadataRoot = resolveScratchDir(repoRoot);
  const metadata = readAgentMetadata(actor, metadataRoot);
  if (!metadata) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `[MISSING_AGENT_METADATA] No durable metadata grant exists for actor '${actor}'.`,
    );
  }
  if (explicitRole !== undefined && explicitRole !== metadata.role) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `[ROLE_ASSERTION_MISMATCH] --role '${explicitRole}' does not match durable role '${metadata.role}'.`,
    );
  }

  const roleName = metadata.role;
  if (
    roleName === "validator" ||
    roleName.startsWith("validator_") ||
    roleName === "completeness_critic"
  ) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `[COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN] Role '${roleName}' is a cognitive validator. Cognitive Validators are locked to 0 command execution.`,
    );
  }

  const policy = loadRepoPolicy(repoRoot);

  // 2. Perform Hard-Coded Mechanical RBAC Authorization
  const auth = verifyCommandAuthorization(metadata, remainder, policy);
  if (!auth.authorized) {
    const errCode =
      auth.error_code === "INVALID_SCOPE" || auth.error_code === "UNSHIELDED_COMMAND_DEFECT"
        ? "INVALID_ARGUMENT"
        : "ROLE_CONFINEMENT_VIOLATION";
    throw new HarnessError(
      errCode,
      auth.message ?? auth.reason ?? "Command execution unauthorized by RBAC policy",
    );
  }

  const startTime = Date.now();
  const commandStr = remainder.join(" ");

  // 3. Standalone direct execution (outside capsule)
  const child = spawnSync(remainder[0]!, remainder.slice(1), {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const durationMs = Date.now() - startTime;
  const exitCode = child.status;
  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  const finishedAt = new Date().toISOString();
  const startedAt = new Date(startTime).toISOString();

  const stdoutSha256 = createHash("sha256").update(stdout).digest("hex");
  const stderrSha256 = createHash("sha256").update(stderr).digest("hex");

  const receiptPayload = {
    actor,
    argv: remainder,
    exit_code: exitCode,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    status: exitCode === 0 ? "success" : "failure",
    stdout_sha256: stdoutSha256,
    stderr_sha256: stderrSha256,
  };
  const receiptSha256 = createHash("sha256").update(JSON.stringify(receiptPayload)).digest("hex");

  const evidenceDir = shellCommandDependencies.resolveEvidenceDir(repoRoot);
  if (!shellCommandDependencies.existsSync(evidenceDir)) {
    shellCommandDependencies.mkdirSync(evidenceDir, { recursive: true });
  }
  const evidenceReceiptPath = join(evidenceDir, `cmd-${receiptSha256.slice(0, 16)}.json`);
  const receiptBody =
    JSON.stringify({ ...receiptPayload, receipt_sha256: receiptSha256 }, null, 2) + "\n";
  persistStandaloneReceipt(evidenceDir, evidenceReceiptPath, receiptBody);

  const tokenEstimate = Math.max(
    1,
    Math.round((stdout.length + stderr.length + commandStr.length) / 4),
  );

  emitTelemetryEvent(
    {
      timestamp: new Date().toISOString(),
      actor,
      task_id: task ?? undefined,
      wave: wave ?? undefined,
      action: `shell: ${commandStr}`,
      status: exitCode === 0 ? "success" : "failure",
      token_estimate: tokenEstimate,
      details: { exit_code: exitCode, receipt_sha256: receiptSha256 },
    },
    repoRoot,
  );

  const lines: string[] = [
    `### Shell Execution Receipt: \`${commandStr}\``,
    `- **Actor**: \`${actor}\``,
    `- **Exit Code**: \`${exitCode}\``,
    `- **Duration**: ${(durationMs / 1000).toFixed(2)}s`,
    `- **Cryptographic Receipt SHA-256**: \`${receiptSha256}\``,
    `- **Evidence Receipt Path**: \`${evidenceReceiptPath}\``,
  ];

  if (stdout.trim()) {
    lines.push(
      "",
      "#### Stdout (last lines):",
      "```",
      stdout.trim().split("\n").slice(-10).join("\n"),
      "```",
    );
  }
  if (stderr.trim()) {
    lines.push(
      "",
      "#### Stderr (last lines):",
      "```",
      stderr.trim().split("\n").slice(-10).join("\n"),
      "```",
    );
  }

  return {
    markdown: lines.join("\n"),
    command: commandStr,
    argv: remainder,
    exit_code: exitCode,
    stdout,
    stderr,
    receipt_sha256: receiptSha256,
    evidence_path: evidenceReceiptPath,
    duration_ms: durationMs,
  };
}
