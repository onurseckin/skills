import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CommandRecord, CommandStatus } from "../contracts/commands.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/load.ts";

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
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
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
  const cwd = process.cwd();

  const candidates: string[] = [
    ...(startPath ? [resolve(startPath)] : []),
    resolve(cwd),
    resolve(cwd, ".capsules"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;

    if (
      existsSync(join(candidate, "state.json")) ||
      existsSync(join(candidate, "manifest.json"))
    ) {
      roots.add(candidate);
      const parent = dirname(candidate);
      if (existsSync(parent) && lstatSync(parent).isDirectory()) {
        scanCapsulesDir(parent, roots);
      }
    } else if (lstatSync(candidate).isDirectory()) {
      scanCapsulesDir(candidate, roots);
      const subCapsules = join(candidate, ".capsules");
      if (existsSync(subCapsules) && lstatSync(subCapsules).isDirectory()) {
        scanCapsulesDir(subCapsules, roots);
      }
    }
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
  if (!commandId || typeof commandId !== "string" || !commandId.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "witness command id is required and must be non-empty",
    );
  }
  const cleanId = commandId.trim();
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
        const loaded = loadRun(capsuleRoot, false);
        const recordedCommands = loaded.state.commands as Record<string, unknown> | undefined;
        if (recordedCommands && typeof recordedCommands === "object" && recordedCommands[cleanId]) {
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

  if (!stdout && commandRecord.logs?.stdout?.path) {
    const customStdoutPath = isAbsolute(commandRecord.logs.stdout.path)
      ? commandRecord.logs.stdout.path
      : join(capsuleRoot, commandRecord.logs.stdout.path);
    if (existsSync(customStdoutPath)) {
      try {
        stdout = readFileSync(customStdoutPath, "utf-8");
      } catch {
        // ignore
      }
    }
  }

  if (!stderr && commandRecord.logs?.stderr?.path) {
    const customStderrPath = isAbsolute(commandRecord.logs.stderr.path)
      ? commandRecord.logs.stderr.path
      : join(capsuleRoot, commandRecord.logs.stderr.path);
    if (existsSync(customStderrPath)) {
      try {
        stderr = readFileSync(customStderrPath, "utf-8");
      } catch {
        // ignore
      }
    }
  }

  if (!stdout && !stderr && commandRecord.attempts && commandRecord.attempts.length > 0) {
    for (const attempt of commandRecord.attempts) {
      if (attempt.logs?.stdout?.path) {
        const attemptStdout = isAbsolute(attempt.logs.stdout.path)
          ? attempt.logs.stdout.path
          : join(capsuleRoot, attempt.logs.stdout.path);
        if (existsSync(attemptStdout)) {
          try {
            stdout = readFileSync(attemptStdout, "utf-8");
          } catch {
            // ignore
          }
        }
      }
      if (attempt.logs?.stderr?.path) {
        const attemptStderr = isAbsolute(attempt.logs.stderr.path)
          ? attempt.logs.stderr.path
          : join(capsuleRoot, attempt.logs.stderr.path);
        if (existsSync(attemptStderr)) {
          try {
            stderr = readFileSync(attemptStderr, "utf-8");
          } catch {
            // ignore
          }
        }
      }
      if (stdout || stderr) break;
    }
  }

  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
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

  const exitCode =
    commandRecord.exit_code ?? (commandRecord.attempts?.[0]?.exit_code ?? null);

  if (exitCode === 0 || (exitCode === null && commandRecord.status === "succeeded")) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `witness command '${commandId}' exited with code 0; defect witnesses must exit non-zero. A command that succeeds is not a defect.`,
    );
  }

  const effectiveExitCode = exitCode ?? 1;
  const { stdout, stderr, output } = readCommandOutput(resolution);

  if (expectedDefectSubstring && expectedDefectSubstring.trim()) {
    const query = expectedDefectSubstring.trim().toLowerCase();
    const outputLower = output.toLowerCase();
    if (!outputLower.includes(query)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `witness command '${commandId}' output does not contain cited defect substring: '${expectedDefectSubstring}'. Command output must demonstrate the defect.`,
      );
    }
  }

  return {
    commandId,
    capsuleRoot,
    exitCode: effectiveExitCode,
    status: commandRecord.status ?? "failed",
    stdout,
    stderr,
    output,
    evidenceClass: "harness_observed",
    commandRecord,
  };
}
