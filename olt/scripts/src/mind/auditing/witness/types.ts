import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { CommandRecord, CommandStatus } from "../../../core/contracts/index.ts";
export type { CommandStatus, CommandRecord };
import { HarnessError } from "../../../core/errors/index.ts";

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
