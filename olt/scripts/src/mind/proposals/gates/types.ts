import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { readArchivedObjectives, type ArchivedObjectiveRecord } from "../../archival/index.ts";
import { DEFAULT_MIND_BUDGET } from "../../lifecycle/charter/index.ts";

export interface CandidateRecord {
  readonly id: string;
  readonly kind: "defect" | "proposal";
  readonly statement: string;
  readonly witness_command_id?: string | null;
  readonly charter_goal_ids?: readonly string[];
  readonly charter_goals?: readonly string[];
  readonly falsifier_argv?: readonly string[] | string | null;
  readonly falsifier?: readonly string[] | string | null;
  readonly falsifier_exit?: number | null;
  readonly write_scope: readonly string[];
  readonly status: "opened" | "admitted" | "declined" | string;
  readonly decided_at?: string | null;
  readonly decline_reason?: string | null;
  readonly gate_failed?: string | null;
  readonly objective_run_id?: string | null;
  readonly rationale?: string | null;
}

export interface AdmissionGateVerdict {
  readonly gateId: string;
  readonly gateNumber: number;
  readonly name: string;
  readonly passed: boolean;
  readonly reason?: string;
  readonly repairArgv?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AdmissionEvaluationResult {
  readonly admitted: boolean;
  readonly candidateId: string;
  readonly failingGate?: AdmissionGateVerdict;
  readonly verdicts: readonly AdmissionGateVerdict[];
  readonly falsifierExitObserved?: number | null;
}

export interface GateEvaluationContext {
  readonly runRoot: string;
  readonly repoRoot: string;
  readonly actor: string;
  readonly state: Record<string, unknown>;
  readonly charterGoals?: ReadonlySet<string>;
  readonly charterNonGoals?: readonly string[];
  readonly repoRoots?: readonly string[];
  readonly falsifierTimeoutMs?: number;
}

export interface CommandRecordCandidate {
  readonly id: string;
  readonly exit_code?: number | null;
  readonly status?: string;
  readonly logs?: {
    readonly stdout?: { readonly path?: string; readonly bytes?: number };
    readonly stderr?: { readonly path?: string; readonly bytes?: number };
  };
  readonly attempts?: readonly {
    readonly exit_code?: number | null;
    readonly logs?: {
      readonly stdout?: { readonly path?: string; readonly bytes?: number };
      readonly stderr?: { readonly path?: string; readonly bytes?: number };
    };
  }[];
  readonly output?: string;
}

export function findCommandRecord(
  runRoot: string,
  commandId: string,
  state?: Record<string, unknown>,
): CommandRecordCandidate | null {
  if (!commandId || typeof commandId !== "string") return null;

  // 1. Check in state.commands if provided
  if (state && typeof state.commands === "object" && state.commands !== null) {
    const fromState = (state.commands as Record<string, unknown>)[commandId];
    if (fromState && typeof fromState === "object") {
      return fromState as CommandRecordCandidate;
    }
  }

  // 2. Check runRoot/commands/<commandId>/record.json
  const directPath = resolve(runRoot, "commands", commandId, "record.json");
  if (existsSync(directPath)) {
    try {
      const content = readFileSync(directPath, "utf-8");
      return JSON.parse(content) as CommandRecordCandidate;
    } catch {
      // ignore parse errors and proceed
    }
  }

  // 3. Check sibling runs under capsules directory
  const capsulesDir = dirname(runRoot);
  if (existsSync(capsulesDir) && lstatSync(capsulesDir).isDirectory()) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const siblingPath = resolve(
            capsulesDir,
            entry.name,
            "commands",
            commandId,
            "record.json",
          );
          if (existsSync(siblingPath)) {
            try {
              const content = readFileSync(siblingPath, "utf-8");
              return JSON.parse(content) as CommandRecordCandidate;
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch {
      // ignore filesystem scan errors
    }
  }

  return null;
}

export function readCandidateCommandOutput(
  record: CommandRecordCandidate,
  runRoot: string,
): string {
  if (typeof record.output === "string") {
    return record.output;
  }

  let stdout = "";
  let stderr = "";

  const extractFromLogs = (logs?: {
    readonly stdout?: { readonly path?: string };
    readonly stderr?: { readonly path?: string };
  }): void => {
    if (!logs) return;
    if (logs.stdout?.path) {
      const stdoutFile = isAbsolute(logs.stdout.path)
        ? logs.stdout.path
        : resolve(runRoot, logs.stdout.path);
      if (existsSync(stdoutFile)) {
        try {
          stdout = readFileSync(stdoutFile, "utf-8");
        } catch {
          // ignore
        }
      }
    }
    if (logs.stderr?.path) {
      const stderrFile = isAbsolute(logs.stderr.path)
        ? logs.stderr.path
        : resolve(runRoot, logs.stderr.path);
      if (existsSync(stderrFile)) {
        try {
          stderr = readFileSync(stderrFile, "utf-8");
        } catch {
          // ignore
        }
      }
    }
  };

  extractFromLogs(record.logs);

  if (!stdout && !stderr && Array.isArray(record.attempts) && record.attempts.length > 0) {
    const lastAttempt = record.attempts[record.attempts.length - 1];
    extractFromLogs(lastAttempt?.logs);
  }

  return `${stdout}\n${stderr}`.trim();
}

export function outputContainsDefect(output: string, statement: string): boolean {
  if (!output || !output.trim()) return false;
  if (!statement || !statement.trim()) return true;

  const normalizedOutput = output.toLowerCase();
  const normalizedStatement = statement.toLowerCase().trim();

  // 1. Direct substring match
  if (normalizedOutput.includes(normalizedStatement)) {
    return true;
  }

  // 2. Word/token match
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "is",
    "are",
    "was",
    "were",
    "this",
    "that",
    "it",
    "from",
    "by",
    "as",
  ]);

  const tokens = normalizedStatement
    .split(/[\s,.;:!?()[\]{}"'`/\\#_-]+/)
    .filter((t) => t.length >= 3 && !stopWords.has(t));

  if (tokens.length === 0) {
    return true;
  }

  // Check if at least one meaningful token matches
  const matchCount = tokens.filter((token) => normalizedOutput.includes(token)).length;
  return matchCount > 0;
}
