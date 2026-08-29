import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../../../core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../core/json.ts";
import { safeCpSync, safeRmSync } from "../../../core/shared/safe-fs/index.ts";
import { RUN_ID_PATTERN } from "../layout/constants.ts";
import { resolveStoragePaths } from "./storage-paths.ts";

export interface MigrationResult {
  readonly migratedCount: number;
  readonly errors: readonly string[];
}

export interface RelocationResult {
  readonly relocatedCount: number;
  readonly errors: readonly string[];
}

const VESTIGIAL_LEDGER_FILES = [
  "backlog.jsonl",
  "defects.jsonl",
  "telemetry.jsonl",
  "completed-tasks.jsonl",
  "completed-defects.jsonl",
] as const;

/**
 * Validates the SHA-256 hash chain and structural validity of an events.jsonl file.
 */
export function validateEventsFileShaChain(eventsFilePath: string): {
  readonly valid: boolean;
  readonly error?: string;
} {
  if (!existsSync(eventsFilePath)) return { valid: true };

  let rawContent: string;
  try {
    rawContent = readFileSync(eventsFilePath, "utf-8");
  } catch (err) {
    return {
      valid: false,
      error: `Failed to read events file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!rawContent.trim()) return { valid: true };

  const lines = rawContent.split("\n");
  let expectedPreviousHash: string | null = null;
  let expectedSequence = 1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch (err) {
      return {
        valid: false,
        error: `Line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: `Line ${i + 1} must be a JSON object` };
    }

    const record = parsed as Record<string, unknown>;
    const hash = record.hash;
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      return {
        valid: false,
        error: `Line ${i + 1} has invalid or missing SHA-256 hash: "${String(hash)}"`,
      };
    }

    if (record.previous_hash !== expectedPreviousHash) {
      return {
        valid: false,
        error: `Line ${i + 1} previous_hash "${String(record.previous_hash)}" does not match expected "${String(expectedPreviousHash)}"`,
      };
    }

    if (typeof record.sequence === "number" && record.sequence !== expectedSequence) {
      return {
        valid: false,
        error: `Line ${i + 1} sequence ${record.sequence} does not match expected sequence ${expectedSequence}`,
      };
    }

    const { hash: _omittedHash, ...content } = record;
    const computedHash = sha256Bytes(canonicalJsonBytes(content as JsonObject));
    if (hash !== computedHash) {
      return {
        valid: false,
        error: `Line ${i + 1} hash mismatch: recorded "${hash}" != computed "${computedHash}"`,
      };
    }

    expectedPreviousHash = hash;
    expectedSequence += 1;
  }

  return { valid: true };
}

/**
 * Validates that an existing migrated run directory has valid integrity.
 */
export function validateMigratedRun(capsuleDir: string): {
  readonly valid: boolean;
  readonly error?: string;
} {
  if (!existsSync(capsuleDir) || !lstatSync(capsuleDir).isDirectory()) {
    return { valid: false, error: `Capsule directory does not exist: "${capsuleDir}"` };
  }
  return validateEventsFileShaChain(join(capsuleDir, "events.jsonl"));
}

/**
 * Migrates legacy capsules from `.capsules/`, `olt/capsules/`, and `capsules/`
 * into the sovereign directory `<repoRoot>/.olt/capsules/<run_id>/`.
 *
 * Verifies SHA-256 hash chains of `events.jsonl` if present. If broken hashes are
 * detected, records the error and halts migration for that capsule to prevent target corruption.
 */
export function migrateLegacyCapsules(repoRoot?: string): MigrationResult {
  const paths = resolveStoragePaths(repoRoot);
  const errors: string[] = [];
  let migratedCount = 0;

  const legacyDirs = [
    join(paths.repoRoot, ".capsules"),
    join(paths.repoRoot, "olt", "capsules"),
    join(paths.repoRoot, "capsules"),
  ];

  mkdirSync(paths.capsulesDir, { recursive: true });

  for (const legacyDir of legacyDirs) {
    if (!existsSync(legacyDir)) continue;

    let entries: Dirent[];
    try {
      entries = readdirSync(legacyDir, { withFileTypes: true });
    } catch (err) {
      errors.push(
        `Failed to read legacy directory ${legacyDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runId = entry.name;

      if (!RUN_ID_PATTERN.test(runId)) {
        errors.push(`Invalid legacy capsule runId directory: "${runId}" at ${legacyDir}`);
        continue;
      }

      const legacyCapsulePath = join(legacyDir, runId);
      const validation = validateEventsFileShaChain(join(legacyCapsulePath, "events.jsonl"));

      if (!validation.valid) {
        errors.push(
          `Legacy capsule "${runId}" at ${legacyCapsulePath} failed integrity check: ${validation.error}`,
        );
        continue;
      }

      const targetCapsulePath = join(paths.capsulesDir, runId);
      if (existsSync(targetCapsulePath)) {
        errors.push(
          `Target capsule directory already exists for "${runId}" at ${targetCapsulePath}; skipping migration to prevent overwrite`,
        );
        continue;
      }

      try {
        safeCpSync(legacyCapsulePath, targetCapsulePath, { allowedRoots: [paths.repoRoot] });
        safeRmSync(legacyCapsulePath, { allowedRoots: [paths.repoRoot], missingOk: true });
        migratedCount += 1;
      } catch (err) {
        errors.push(
          `Failed to migrate capsule "${runId}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      if (readdirSync(legacyDir).length === 0) {
        safeRmSync(legacyDir, { allowedRoots: [paths.repoRoot], missingOk: true });
      }
    } catch {
      // Ignore cleanup error of empty legacy dir
    }
  }

  return { migratedCount, errors: Object.freeze(errors) };
}

/**
 * Checks for runtime ledgers in static package root `olt/` and relocates / merges
 * them into `.olt/`, cleaning up source files from `olt/`.
 */
export function relocateVestigialLedgers(repoRoot?: string): RelocationResult {
  const paths = resolveStoragePaths(repoRoot);
  const staticOltDir = join(paths.repoRoot, "olt");
  const errors: string[] = [];
  let relocatedCount = 0;

  if (!existsSync(staticOltDir)) return { relocatedCount: 0, errors: Object.freeze([]) };

  mkdirSync(paths.oltDir, { recursive: true });

  for (const fileName of VESTIGIAL_LEDGER_FILES) {
    const sourceFile = join(staticOltDir, fileName);
    const targetFile = join(paths.oltDir, fileName);
    if (!existsSync(sourceFile)) continue;

    try {
      const sourceRaw = readFileSync(sourceFile, "utf-8");
      const sourceLines = sourceRaw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (sourceLines.length > 0) {
        if (existsSync(targetFile)) {
          const targetRaw = readFileSync(targetFile, "utf-8");
          const targetLines = targetRaw
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
          const targetSet = new Set(targetLines);
          const merged = [...targetLines];
          for (const line of sourceLines) {
            if (!targetSet.has(line)) {
              merged.push(line);
              targetSet.add(line);
            }
          }
          writeFileSync(targetFile, merged.join("\n") + "\n", "utf-8");
        } else {
          writeFileSync(targetFile, sourceLines.join("\n") + "\n", "utf-8");
        }
      } else if (!existsSync(targetFile)) {
        writeFileSync(targetFile, "", "utf-8");
      }

      safeRmSync(sourceFile, { allowedRoots: [paths.repoRoot], missingOk: true });
      relocatedCount += 1;
    } catch (err) {
      errors.push(
        `Failed to relocate ledger "${fileName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const sourceScratch = join(staticOltDir, "scratch");
  if (existsSync(sourceScratch)) {
    try {
      mkdirSync(paths.scratchDir, { recursive: true });
      for (const item of readdirSync(sourceScratch)) {
        safeCpSync(join(sourceScratch, item), join(paths.scratchDir, item), {
          allowedRoots: [paths.repoRoot],
          allowOverwrite: true,
        });
      }
      safeRmSync(sourceScratch, { allowedRoots: [paths.repoRoot], missingOk: true });
      relocatedCount += 1;
    } catch (err) {
      errors.push(
        `Failed to relocate scratch directory: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { relocatedCount, errors: Object.freeze(errors) };
}
