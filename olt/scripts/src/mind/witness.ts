import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { CommandRecord, CommandStatus } from "../core/contracts/commands.ts";
import { HarnessError } from "../core/errors/harness-error.ts";

export interface WitnessResolution {
  readonly commandId: string;
  readonly capsuleRoot: string;
  readonly recordPath: string;
  readonly commandRecord: CommandRecord;
}

export interface DefectWitnessVerification {
  readonly commandId: string;
  readonly capsuleRoot: string;
  readonly exitCode: number;
  readonly status: CommandStatus;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
  readonly evidenceClass: "harness_observed";
  readonly commandRecord: CommandRecord;
}

function scanCapsulesDir(dir: string, roots: Set<string>): void {
  try {
    if (!existsSync(dir)) {
      return;
    }
    const stat = lstatSync(dir);
    if (!stat.isDirectory()) {
      return;
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const sub = join(dir, entry.name);
        if (
          existsSync(join(sub, "state.json")) ||
          existsSync(join(sub, "manifest.json")) ||
          existsSync(join(sub, "commands"))
        ) {
          roots.add(sub);
        }
      }
    }
  } catch {
    // ignore unreadable directory
  }
}

function collectCapsuleSearchRoots(startPath?: string): string[] {
  const roots = new Set<string>();

  if (typeof startPath === "string" && startPath.trim().length > 0) {
    const resolvedStart = resolve(startPath.trim());
    if (existsSync(resolvedStart)) {
      const isRunItself =
        existsSync(join(resolvedStart, "state.json")) ||
        existsSync(join(resolvedStart, "manifest.json")) ||
        existsSync(join(resolvedStart, "commands"));

      if (isRunItself) {
        roots.add(resolvedStart);
        const parentDir = dirname(resolvedStart);
        // Only scan sibling capsules if parent directory is named ".capsules"
        if (basename(parentDir) === ".capsules" && existsSync(parentDir)) {
          scanCapsulesDir(parentDir, roots);
        }
      } else {
        const stat = lstatSync(resolvedStart);
        if (stat.isDirectory()) {
          const subCapsules = join(resolvedStart, ".capsules");
          if (existsSync(subCapsules) && lstatSync(subCapsules).isDirectory()) {
            scanCapsulesDir(subCapsules, roots);
          } else {
            scanCapsulesDir(resolvedStart, roots);
          }
        }
      }
    }
  }

  const defaultCapsulesDir = resolve(process.cwd(), ".capsules");
  if (existsSync(defaultCapsulesDir) && lstatSync(defaultCapsulesDir).isDirectory()) {
    scanCapsulesDir(defaultCapsulesDir, roots);
  }

  const cwdResolved = resolve(process.cwd());
  const cwdIsRun =
    existsSync(join(cwdResolved, "state.json")) || existsSync(join(cwdResolved, "manifest.json"));
  if (cwdIsRun) {
    roots.add(cwdResolved);
  }

  return Array.from(roots);
}

/**
 * Resolves a recorded command ID by scanning under `.capsules/` directories.
 * Refuses if the command ID does not exist in any capsule.
 */
export function resolveWitnessCommand(
  commandId: string,
  capsuleRunOrRepoPath?: string,
): WitnessResolution {
  if (typeof commandId !== "string") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "witness command id is required and must be non-empty",
    );
  }
  const cleanId = commandId.trim();
  if (cleanId.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "witness command id is required and must be non-empty",
    );
  }
  const searchRoots = collectCapsuleSearchRoots(capsuleRunOrRepoPath);

  for (const capsuleRoot of searchRoots) {
    const directRecordPath = join(capsuleRoot, "commands", cleanId, "record.json");
    if (existsSync(directRecordPath)) {
      try {
        const content = readFileSync(directRecordPath, "utf-8");
        const record = JSON.parse(content) as CommandRecord;
        return {
          commandId: cleanId,
          capsuleRoot,
          recordPath: directRecordPath,
          commandRecord: record,
        };
      } catch {
        // continue search
      }
    }

    const flatRecordPath = join(capsuleRoot, "commands", `${cleanId}.json`);
    if (existsSync(flatRecordPath)) {
      try {
        const content = readFileSync(flatRecordPath, "utf-8");
        const record = JSON.parse(content) as CommandRecord;
        return {
          commandId: cleanId,
          capsuleRoot,
          recordPath: flatRecordPath,
          commandRecord: record,
        };
      } catch {
        // continue search
      }
    }

    const statePath = join(capsuleRoot, "state.json");
    if (existsSync(statePath)) {
      try {
        const content = readFileSync(statePath, "utf-8");
        const stateObj = JSON.parse(content) as Record<string, unknown>;
        const recordedCommands = stateObj.commands as Record<string, unknown> | undefined;
        if (
          recordedCommands !== undefined &&
          recordedCommands !== null &&
          typeof recordedCommands === "object" &&
          Object.prototype.hasOwnProperty.call(recordedCommands, cleanId)
        ) {
          const record = recordedCommands[cleanId] as CommandRecord;
          return {
            commandId: cleanId,
            capsuleRoot,
            recordPath: directRecordPath,
            commandRecord: record,
          };
        }
      } catch {
        // continue search
      }
    }
  }

  throw new HarnessError(
    "INVALID_ARGUMENT",
    `command '${cleanId}' does not exist in any capsule under .capsules/; provide a valid recorded command id evidencing the defect`,
  );
}

/**
 * Reads the stdout and stderr content for a resolved command.
 */
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
      // ignore
    }
  }
  if (existsSync(stdStderrPath)) {
    try {
      stderr = readFileSync(stdStderrPath, "utf-8");
    } catch {
      // ignore
    }
  }

  if (stdout.length === 0 && commandRecord.logs?.stdout?.path) {
    const stdoutPath = commandRecord.logs.stdout.path;
    const customStdoutPath = isAbsolute(stdoutPath) ? stdoutPath : join(capsuleRoot, stdoutPath);
    if (existsSync(customStdoutPath)) {
      try {
        stdout = readFileSync(customStdoutPath, "utf-8");
      } catch {
        // ignore
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
        // ignore
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
            // ignore
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
            // ignore
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

  let status: CommandStatus = "failed";
  if (typeof commandRecord.status === "string") {
    status = commandRecord.status;
  }

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
