import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import { runAndRecordCommand } from "../../integration/record-command.ts";
import { declaredToolFlags } from "../taxonomy-flags.ts";
import { formatRunExecBrief } from "../formatters/index.ts";
import { actorFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { loadRepoPolicy } from "../../policy/repo-policy.ts";
import { verifyCommandAuthorization } from "../../policy/rbac-engine.ts";
import { createAgentMetadata, readAgentMetadata } from "../../runtime/agent-metadata.ts";
import { emitTelemetryEvent } from "../../reporting/telemetry-stream.ts";
import { findRepoRoot, resolveEvidenceDir } from "../../shared/paths.ts";

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
  const cwd = textFlag(flags, "cwd", false) ?? process.cwd();
  const explicitRole = textFlag(flags, "role", false);

  if (!remainder || remainder.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "shell command requires an executable command following '--'",
    );
  }

  const repoRoot = findRepoRoot(cwd);
  const policy = loadRepoPolicy(repoRoot);

  // 1. Resolve agent metadata
  let metadata = readAgentMetadata(actor, run ? resolve(run) : undefined);
  if (!metadata) {
    metadata = createAgentMetadata({
      agent_id: actor,
      role: explicitRole ?? "implementer",
      can_execute_shell: explicitRole ? undefined : true,
    });
  }

  // 2. Perform Hard-Coded Mechanical RBAC Authorization
  const auth = verifyCommandAuthorization(metadata, remainder, policy);
  if (!auth.authorized) {
    const errCode =
      auth.error_code === "INVALID_SCOPE" || auth.error_code === "UNSHIELDED_COMMAND_BLUNDER"
        ? "INVALID_ARGUMENT"
        : "ROLE_CONFINEMENT_VIOLATION";
    throw new HarnessError(
      errCode,
      auth.message ?? auth.reason ?? "Command execution unauthorized by RBAC policy",
    );
  }

  const startTime = Date.now();
  const commandStr = remainder.join(" ");

  // 3. Execution under capsule record if run is provided
  if (run) {
    const loaded = loadRun(run);
    const declared = declaredToolFlags(flags);
    const commandDir = declared.toolCategory === "test-runner" ? "commands" : "commands";

    const cmdOpts = {
      commandDir,
      cwd,
      actor,
      argv: [...remainder],
      ...(task ? { taskId: task } : {}),
      ...(gate ? { gateId: gate } : {}),
      ...declared,
    };

    const result = await runAndRecordCommand(loaded.runRoot, cmdOpts);
    const record = result.record;
    const durationMs = Date.now() - startTime;
    const exitCode = record.exit_code;

    const rawStdout =
      typeof record.stdout === "string" ? record.stdout : JSON.stringify(record.stdout ?? "");
    const rawStderr =
      typeof record.stderr === "string" ? record.stderr : JSON.stringify(record.stderr ?? "");
    const stdoutSha256 = createHash("sha256").update(rawStdout).digest("hex");
    const stderrSha256 = createHash("sha256").update(rawStderr).digest("hex");

    const receiptPayload = {
      actor,
      argv: remainder,
      exit_code: exitCode,
      started_at: record.started_at,
      finished_at: record.finished_at,
      duration_ms: durationMs,
      status: record.status,
      command_id: record.id,
      stdout_sha256: stdoutSha256,
      stderr_sha256: stderrSha256,
    };
    const receiptSha256 = createHash("sha256").update(JSON.stringify(receiptPayload)).digest("hex");

    const evidenceDir = join(loaded.runRoot, "evidence");
    if (!existsSync(evidenceDir)) {
      mkdirSync(evidenceDir, { recursive: true });
    }
    const evidenceReceiptPath = join(evidenceDir, `cmd-${record.id}.json`);
    writeFileSync(
      evidenceReceiptPath,
      JSON.stringify({ ...receiptPayload, receipt_sha256: receiptSha256 }, null, 2) + "\n",
      "utf-8",
    );

    const tokenEstimate = Math.max(
      1,
      Math.round((rawStdout.length + rawStderr.length + commandStr.length) / 4),
    );

    emitTelemetryEvent(
      {
        timestamp: new Date().toISOString(),
        actor,
        task_id: task ?? record.task_id ?? undefined,
        wave: wave ?? undefined,
        action: `shell: ${commandStr}`,
        status: exitCode === 0 ? "success" : "failure",
        token_estimate: tokenEstimate,
        details: { exit_code: exitCode, command_id: record.id, receipt_sha256: receiptSha256 },
      },
      repoRoot,
    );

    const markdown = formatRunExecBrief({
      commandStr,
      exitCode,
      durationSeconds: durationMs / 1000,
      outputSummary: exitCode === 0 ? "Command completed successfully" : "Command failed",
      evidencePath: evidenceReceiptPath,
      logPath: result.recordPath,
    });

    return {
      markdown,
      command: commandStr,
      argv: remainder,
      exit_code: exitCode,
      receipt_sha256: receiptSha256,
      evidence_path: evidenceReceiptPath,
      duration_ms: durationMs,
    };
  }

  // 4. Standalone direct execution (outside capsule)
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

  const evidenceDir = resolveEvidenceDir(repoRoot);
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }
  const evidenceReceiptPath = join(evidenceDir, `cmd-${receiptSha256.slice(0, 16)}.json`);
  writeFileSync(
    evidenceReceiptPath,
    JSON.stringify({ ...receiptPayload, receipt_sha256: receiptSha256 }, null, 2) + "\n",
    "utf-8",
  );

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
