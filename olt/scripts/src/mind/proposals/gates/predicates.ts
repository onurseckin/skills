import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  AdmissionGateVerdict,
  CandidateRecord,
  CommandRecordCandidate,
  GateEvaluationContext,
} from "./types.ts";
import { findCommandRecord, readCandidateCommandOutput, outputContainsDefect } from "./types.ts";
export function isPathInRepoRoots(
  targetPath: string,
  repoRoots: readonly string[],
  repoRoot: string,
): boolean {
  if (!targetPath || typeof targetPath !== "string" || !targetPath.trim()) {
    return false;
  }

  const resolvedRepoRoot = resolve(repoRoot || ".");
  const absoluteTarget = isAbsolute(targetPath.trim())
    ? resolve(targetPath.trim())
    : resolve(resolvedRepoRoot, targetPath.trim());

  // Target must be inside repoRoot or equal to repoRoot
  const relToRepo = relative(resolvedRepoRoot, absoluteTarget);
  if (relToRepo.startsWith("..") || isAbsolute(relToRepo)) {
    return false;
  }

  const effectiveRoots = repoRoots && repoRoots.length > 0 ? repoRoots : ["."];

  if (
    effectiveRoots.some((r) => {
      const trimmed = r.trim();
      return trimmed === "." || trimmed === "./" || trimmed === "*" || trimmed === "";
    })
  ) {
    return true;
  }

  for (const root of effectiveRoots) {
    const trimmedRoot = root.trim();
    if (!trimmedRoot) continue;
    if (trimmedRoot === "." || trimmedRoot === "./" || trimmedRoot === "*") {
      return true;
    }

    const absoluteRoot = isAbsolute(trimmedRoot)
      ? resolve(trimmedRoot)
      : resolve(resolvedRepoRoot, trimmedRoot);

    const relToRoot = relative(absoluteRoot, absoluteTarget);
    if (relToRoot === "" || (!relToRoot.startsWith("..") && !isAbsolute(relToRoot))) {
      return true;
    }
  }

  return false;
}

export function executeFalsifier(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number = 30000,
): { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean } {
  if (!argv || argv.length === 0) {
    return { exitCode: null, stdout: "", stderr: "no argv provided", timedOut: false };
  }

  try {
    const proc = spawnSync(argv[0]!, argv.slice(1), {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, CI: "1" },
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const timedOut =
      proc.error !== undefined && "code" in proc.error && proc.error.code === "ETIMEDOUT";
    const exitCode = timedOut ? null : proc.status;
    const stdout = typeof proc.stdout === "string" ? proc.stdout : "";
    const stderr = typeof proc.stderr === "string" ? proc.stderr : "";

    return { exitCode, stdout, stderr, timedOut };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: msg, timedOut: false };
  }
}

export function parseFalsifierArgv(raw?: readonly string[] | string | null): readonly string[] {
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (typeof raw === "string") {
    return (
      raw
        .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
        ?.map((token) => token.replace(/^["']|["']$/g, ""))
        ?.filter((s) => s.length > 0) ?? []
    );
  }
  return [];
}

/**
 * Gate 1: Witnessed
 * Is there a recorded command whose output shows this defect?
 * Decided by: harness: the command record exists and its output matches.
 */
export function evaluateGate1Witnessed(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-1-witnessed";
  const gateNumber = 1;
  const name = "Witnessed";

  if (candidate.kind === "proposal") {
    if (candidate.witness_command_id === "owner-decision") {
      return {
        gateId,
        gateNumber,
        name,
        passed: true,
        metadata: { witness: "owner-decision", kind: "proposal" },
      };
    }
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "proposals require an owner authority decision ('owner-decision') before admission",
      repairArgv: `bun harness.ts authority:decide --run ${context.runRoot} --requirement ${candidate.id} --decision grant`,
    };
  }

  const witnessId = candidate.witness_command_id?.trim();
  if (!witnessId) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "defect candidate has no witness command record",
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --kind defect --statement "${candidate.statement}" --witness <command-id>`,
    };
  }

  if (witnessId === "owner-decision") {
    return {
      gateId,
      gateNumber,
      name,
      passed: true,
      metadata: { witness: "owner-decision" },
    };
  }

  const record = findCommandRecord(context.runRoot, witnessId, context.state);
  if (!record) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `witness command '${witnessId}' not found in any capsule command records`,
      repairArgv: `bun harness.ts run:exec --run ${context.runRoot} --actor ${context.actor} -- <command>`,
    };
  }

  const exitCode =
    record.exit_code !== undefined
      ? record.exit_code
      : record.status === "succeeded"
        ? 0
        : record.status === "failed"
          ? 1
          : null;

  if (exitCode === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `witness command '${witnessId}' recorded exit was 0; a defect witness must exit non-zero`,
      repairArgv: `bun harness.ts run:exec --run ${context.runRoot} --actor ${context.actor} -- <failing-command>`,
    };
  }

  const output = readCandidateCommandOutput(record, context.runRoot);
  if (output && !outputContainsDefect(output, candidate.statement)) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `witness command '${witnessId}' output does not contain the cited defect ('${candidate.statement}')`,
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --witness <matching-command-id>`,
    };
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { witnessCommandId: witnessId, exitCode },
  };
}

/**
 * Gate 2: In charter
 * Does a charter goal id admit it? Does any non-goal exclude it?
 * Decided by: harness: goal id must be cited and must exist in the pinned charter.
 */
