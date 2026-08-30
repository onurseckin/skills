import { HarnessError } from "../../../core/errors/index.ts";
import { isAbsolute, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { WitnessResolution, DefectWitnessVerification, CommandStatus } from "./types.ts";
import { resolveWitnessCommand } from "./types.ts";
export function readCommandOutput(resolution: WitnessResolution): {
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
} {
  const { capsuleRoot, commandId, commandRecord } = resolution;
  let stdout = "";
  let stderr = "";

  const stdStdoutPath = join(capsuleRoot, "commands", commandId, "stdout.log");
  const stdStderrPath = join(capsuleRoot, "commands", commandId, "stderr.log");
  if (existsSync(stdStdoutPath)) {
    try {
      stdout = readFileSync(stdStdoutPath, "utf-8");
    } catch {

    }
  }
  if (existsSync(stdStderrPath)) {
    try {
      stderr = readFileSync(stdStderrPath, "utf-8");
    } catch {

    }
  }

  if (stdout.length === 0 && commandRecord.logs?.stdout?.path) {
    const stdoutPath = commandRecord.logs.stdout.path;
    const customStdoutPath = isAbsolute(stdoutPath) ? stdoutPath : join(capsuleRoot, stdoutPath);
    if (existsSync(customStdoutPath)) {
      try {
        stdout = readFileSync(customStdoutPath, "utf-8");
      } catch {

      }
    }
  }

  if (stderr.length === 0 && commandRecord.logs?.stderr?.path) {
    const stderrPath = commandRecord.logs.stderr.path;
    const customStderrPath = isAbsolute(stderrPath) ? stderrPath : join(capsuleRoot, stderrPath);
    if (existsSync(customStderrPath)) {
      try {
        stderr = readFileSync(customStderrPath, "utf-8");
      } catch {

      }
    }
  }

  if (
    stdout.length === 0 &&
    stderr.length === 0 &&
    Array.isArray(commandRecord.attempts) &&
    commandRecord.attempts.length > 0
  ) {
    for (const attempt of commandRecord.attempts) {
      if (attempt.logs?.stdout?.path) {
        const attemptStdoutPath = attempt.logs.stdout.path;
        const attemptStdout = isAbsolute(attemptStdoutPath)
          ? attemptStdoutPath
          : join(capsuleRoot, attemptStdoutPath);
        if (existsSync(attemptStdout)) {
          try {
            stdout = readFileSync(attemptStdout, "utf-8");
          } catch {

          }
        }
      }
      if (attempt.logs?.stderr?.path) {
        const attemptStderrPath = attempt.logs.stderr.path;
        const attemptStderr = isAbsolute(attemptStderrPath)
          ? attemptStderrPath
          : join(capsuleRoot, attemptStderrPath);
        if (existsSync(attemptStderr)) {
          try {
            stderr = readFileSync(attemptStderr, "utf-8");
          } catch {

          }
        }
      }
      if (stdout.length > 0 || stderr.length > 0) {
        break;
      }
    }
  }

  const parts: string[] = [];
  if (stdout.length > 0) {
    parts.push(stdout);
  }
  if (stderr.length > 0) {
    parts.push(stderr);
  }
  const output = parts.join("\n").trim();
  return { stdout, stderr, output };
}

/**
 * Verifies a defect witness command:
 * 1. Resolves command ID under `.capsules/`.
 * 2. Verifies exit code != 0 (must be non-zero failure).
 * 3. If defect substring or phrase is provided, checks that command output contains it.
 * 4. Returns harness_observed verification record.
 */
export function verifyDefectWitness(
  commandId: string,
  capsuleRunOrRepoPath?: string,
  expectedDefectSubstring?: string,
): DefectWitnessVerification {
  const resolution = resolveWitnessCommand(commandId, capsuleRunOrRepoPath);
  const { commandRecord, capsuleRoot } = resolution;

  let exitCode: number | null = null;
  if (typeof commandRecord.exit_code === "number") {
    exitCode = commandRecord.exit_code;
  } else if (
    Array.isArray(commandRecord.attempts) &&
    commandRecord.attempts.length > 0 &&
    typeof commandRecord.attempts[0]?.exit_code === "number"
  ) {
    exitCode = commandRecord.attempts[0].exit_code;
  }

  if (exitCode === 0 || (exitCode === null && commandRecord.status === "succeeded")) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `witness command '${commandId}' exited with code 0; defect witnesses must exit non-zero. A command that succeeds is not a defect.`,
    );
  }

  const effectiveExitCode: number = typeof exitCode === "number" ? exitCode : 1;
  const { stdout, stderr, output } = readCommandOutput(resolution);

  if (typeof expectedDefectSubstring === "string" && expectedDefectSubstring.trim().length > 0) {
    const query = expectedDefectSubstring.trim().toLowerCase();
    const outputLower = output.toLowerCase();
    if (!outputLower.includes(query)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `witness command '${commandId}' output does not contain cited defect substring: '${expectedDefectSubstring}'. Command output must demonstrate the defect.`,
      );
    }
  }

  let status: CommandStatus = (
    typeof commandRecord.status === "string" ? commandRecord.status : "failed"
  ) as CommandStatus;

  return {
    commandId,
    capsuleRoot,
    exitCode: effectiveExitCode,
    status,
    stdout,
    stderr,
    output,
    evidenceClass: "harness_observed",
    commandRecord,
  };
}
