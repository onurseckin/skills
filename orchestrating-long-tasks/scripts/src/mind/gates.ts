import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { scopeConflict } from "../scheduler/conflicts.ts";
import { DEFAULT_MIND_BUDGET } from "./charter.ts";

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

export function readCandidateCommandOutput(record: CommandRecordCandidate, runRoot: string): string {
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

export function isPathInRepoRoots(
  targetPath: string,
  repoRoots: readonly string[],
  repoRoot: string,
): boolean {
  if (!targetPath) return false;
  if (
    repoRoots.length === 0 ||
    repoRoots.includes(".") ||
    repoRoots.includes("./") ||
    repoRoots.includes("*")
  ) {
    return true;
  }

  const normalizedTarget = normalize(targetPath).replace(/^[./\\]+/, "");
  const absoluteTarget = resolve(repoRoot, normalizedTarget);

  for (const root of repoRoots) {
    const normalizedRoot = normalize(root)
      .replace(/^[./\\]+/, "")
      .replace(/[/\\]+$/, "");
    if (!normalizedRoot || normalizedRoot === ".") return true;

    if (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)) {
      return true;
    }

    const absoluteRoot = resolve(repoRoot, normalizedRoot);
    if (absoluteTarget === absoluteRoot || absoluteTarget.startsWith(`${absoluteRoot}/`)) {
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
export function evaluateGate2InCharter(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-2-in-charter";
  const gateNumber = 2;
  const name = "In charter";

  const goalIds = (candidate.charter_goal_ids ?? candidate.charter_goals ?? []).filter(
    (g): g is string => typeof g === "string" && g.trim().length > 0,
  );

  if (goalIds.length === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate cites no charter goals",
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --charter-goal G1`,
    };
  }

  const charterGoals = context.charterGoals ?? new Set(["G1"]);
  for (const goalId of goalIds) {
    if (!charterGoals.has(goalId)) {
      const known = [...charterGoals].join(", ");
      return {
        gateId,
        gateNumber,
        name,
        passed: false,
        reason: `charter goal '${goalId}' does not exist in pinned charter (known goals: ${known})`,
        repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --charter-goal ${[...charterGoals][0] ?? "G1"}`,
      };
    }
  }

  const nonGoals = context.charterNonGoals ?? [];
  const statementLower = candidate.statement.toLowerCase();
  for (const nonGoal of nonGoals) {
    const trimmed = nonGoal.trim().toLowerCase();
    if (!trimmed) continue;
    if (
      statementLower.includes(trimmed) ||
      (candidate.write_scope ?? []).some((s) => s.toLowerCase().includes(trimmed))
    ) {
      return {
        gateId,
        gateNumber,
        name,
        passed: false,
        reason: `candidate matches charter non-goal '${nonGoal}'`,
        repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
      };
    }
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { goals: goalIds },
  };
}

/**
 * Gate 3: Falsifiable
 * Is there a command that fails now and would pass if this were fixed?
 * Decided by: agent declares it; harness runs it now and requires non-zero.
 */
export function evaluateGate3Falsifiable(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-3-falsifiable";
  const gateNumber = 3;
  const name = "Falsifiable";

  if (candidate.kind === "proposal") {
    return {
      gateId,
      gateNumber,
      name,
      passed: true,
      metadata: { kind: "proposal" },
    };
  }

  const argv = parseFalsifierArgv(candidate.falsifier_argv ?? candidate.falsifier);
  if (argv.length === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate has no falsifier argv declared",
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --falsifier "<failing command>"`,
    };
  }

  const result = executeFalsifier(argv, context.repoRoot, context.falsifierTimeoutMs);
  if (result.exitCode === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `falsifier command '${argv.join(" ")}' exited with 0; a falsifier must fail (exit non-zero) before the defect is fixed`,
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --falsifier "<failing-command>"`,
      metadata: { exitCode: 0, argv },
    };
  }

  const exitCodeObserved = result.exitCode ?? 1;
  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { exitCode: exitCodeObserved, argv },
  };
}

/**
 * Gate 4: Scoped
 * Is the write scope narrow, disjoint from every live lease, inside the charter's repo roots?
 * Decided by: harness: scopeConflict + charter roots.
 */
export function evaluateGate4Scoped(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-4-scoped";
  const gateNumber = 4;
  const name = "Scoped";

  const scope = (candidate.write_scope ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );

  if (scope.length === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate write scope is empty",
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope <path>`,
    };
  }

  const repoRoots = context.repoRoots ?? ["."];
  for (const path of scope) {
    if (!isPathInRepoRoots(path, repoRoots, context.repoRoot)) {
      return {
        gateId,
        gateNumber,
        name,
        passed: false,
        reason: `write scope '${path}' is outside charter repo_roots (${repoRoots.join(", ")})`,
        repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope ${repoRoots[0] ?? "src/"}`,
      };
    }
  }

  // Conflict against live leases in state.tasks
  const tasks = context.state.tasks as Record<string, Record<string, unknown>> | undefined;
  if (tasks && typeof tasks === "object") {
    for (const [taskId, task] of Object.entries(tasks)) {
      if (!task || typeof task !== "object") continue;
      const status = task.status;
      const lease = task.lease as Record<string, unknown> | undefined;
      const isLeased =
        status === "leased" ||
        (lease !== undefined &&
          lease !== null &&
          (typeof lease.expires_at !== "string" || Date.parse(lease.expires_at) > Date.now()));

      if (isLeased) {
        const taskScope = (
          Array.isArray(lease?.write_scope)
            ? lease.write_scope
            : Array.isArray(task.write_scope)
              ? task.write_scope
              : []
        ) as readonly string[];

        if (scopeConflict(scope, taskScope)) {
          return {
            gateId,
            gateNumber,
            name,
            passed: false,
            reason: `write scope conflicts with live task lease '${taskId}' (${taskScope.join(", ")})`,
            repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope <disjoint-path>`,
          };
        }
      }
    }
  }

  // Conflict against other open/admitted candidates
  const candidates = (
    Array.isArray(context.state.candidates) ? context.state.candidates : []
  ) as readonly CandidateRecord[];
  for (const other of candidates) {
    if (other.id !== candidate.id && (other.status === "opened" || other.status === "admitted")) {
      const otherScope = (other.write_scope ?? []) as readonly string[];
      if (scopeConflict(scope, otherScope)) {
        return {
          gateId,
          gateNumber,
          name,
          passed: false,
          reason: `write scope conflicts with active candidate '${other.id}' (${otherScope.join(", ")})`,
          repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope <disjoint-path>`,
        };
      }
    }
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { writeScope: scope },
  };
}

/**
 * Gate 5: Affordable
 * Does the remaining budget cover the declared round budget?
 * Decided by: harness: arithmetic on the budget ledger.
 */
export function evaluateGate5Affordable(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-5-affordable";
  const gateNumber = 5;
  const name = "Affordable";

  if (!candidate || !candidate.id) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate id is missing",
      repairArgv: `bun harness.ts mind:observe --run ${context.runRoot}`,
    };
  }

  const mindState = (context.state.mind ?? {}) as Record<string, unknown>;
  const budget = (context.state.budget ?? mindState.budget ?? DEFAULT_MIND_BUDGET) as Record<
    string,
    unknown
  >;

  const pulsesToday = typeof budget.pulses_today === "number" ? budget.pulses_today : 0;
  const pulsesPerDay =
    typeof budget.pulses_per_day === "number"
      ? budget.pulses_per_day
      : DEFAULT_MIND_BUDGET.pulses_per_day;
  const wallClockToday =
    typeof budget.wall_clock_ms_today === "number" ? budget.wall_clock_ms_today : 0;
  const wallClockPerDay =
    typeof budget.wall_clock_ms_per_day === "number"
      ? budget.wall_clock_ms_per_day
      : DEFAULT_MIND_BUDGET.wall_clock_ms_per_day;

  if (pulsesPerDay !== null && Number.isFinite(pulsesPerDay) && pulsesToday >= pulsesPerDay) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `daily pulse budget exhausted (${pulsesToday}/${pulsesPerDay} pulses today)`,
      repairArgv: `bun harness.ts mind:wake --run ${context.runRoot}`,
    };
  }

  if (wallClockPerDay !== null && Number.isFinite(wallClockPerDay) && wallClockToday >= wallClockPerDay) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `daily wall-clock budget exhausted (${wallClockToday}/${wallClockPerDay} ms today)`,
      repairArgv: `bun harness.ts mind:wake --run ${context.runRoot}`,
    };
  }

  const agents = (
    Array.isArray(context.state.agents) ? context.state.agents : []
  ) as readonly Record<string, unknown>[];
  const activeAgents = agents.filter(
    (a) => a.status === "active" && (a.role === "implementer" || a.role === "validator"),
  );
  const maxAgents =
    typeof budget.max_agents_in_flight === "number"
      ? budget.max_agents_in_flight
      : DEFAULT_MIND_BUDGET.max_agents_in_flight;

  if (maxAgents !== null && Number.isFinite(maxAgents) && activeAgents.length >= maxAgents) {
    const firstActiveId = String(activeAgents[0]?.id ?? "agent-1");
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `max agents in flight reached (${activeAgents.length}/${maxAgents})`,
      repairArgv: `bun harness.ts agent:release --run ${context.runRoot} --agent ${firstActiveId} --reason "free capacity"`,
    };
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { pulsesToday, pulsesPerDay, wallClockToday, wallClockPerDay },
  };
}

/**
 * Gate 6: Not a duplicate
 * Is there an open candidate, a live task, or a declined candidate with the same witness class and scope?
 * Decided by: harness: candidate ledger lookup.
 */
export function evaluateGate6NotADuplicate(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-6-not-a-duplicate";
  const gateNumber = 6;
  const name = "Not a duplicate";

  const candidates = (
    Array.isArray(context.state.candidates) ? context.state.candidates : []
  ) as readonly CandidateRecord[];

  const scope = (candidate.write_scope ?? []) as readonly string[];
  const statementLower = candidate.statement.trim().toLowerCase();
  const witnessId = candidate.witness_command_id?.trim();

  for (const other of candidates) {
    if (other.id === candidate.id) continue;

    const otherScope = (other.write_scope ?? []) as readonly string[];
    const otherStatementLower = other.statement.trim().toLowerCase();
    const otherWitnessId = other.witness_command_id?.trim();

    if (other.status === "declined") {
      const isWitnessDup =
        witnessId &&
        otherWitnessId &&
        witnessId !== "owner-decision" &&
        witnessId === otherWitnessId;
      const isStatementScopeDup =
        statementLower === otherStatementLower && scopeConflict(scope, otherScope);
      const isProposalDup =
        candidate.kind === "proposal" &&
        other.kind === "proposal" &&
        statementLower === otherStatementLower;

      if (isWitnessDup || isStatementScopeDup || isProposalDup) {
        return {
          gateId,
          gateNumber,
          name,
          passed: false,
          reason: `candidate is a duplicate of permanently declined candidate '${other.id}' (declined reason: '${other.decline_reason ?? "declined"}')`,
          repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
        };
      }
    }

    if (other.status === "opened" || other.status === "admitted") {
      const isWitnessDup =
        witnessId &&
        otherWitnessId &&
        witnessId !== "owner-decision" &&
        witnessId === otherWitnessId;
      const isStatementScopeDup =
        statementLower === otherStatementLower && scopeConflict(scope, otherScope);

      if (isWitnessDup || isStatementScopeDup) {
        return {
          gateId,
          gateNumber,
          name,
          passed: false,
          reason: `candidate is a duplicate of active candidate '${other.id}' (${other.status})`,
          repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
        };
      }
    }
  }

  // Check live tasks
  const tasks = context.state.tasks as Record<string, Record<string, unknown>> | undefined;
  if (tasks && typeof tasks === "object") {
    for (const [taskId, task] of Object.entries(tasks)) {
      if (!task || typeof task !== "object") continue;
      const status = String(task.status);
      if (status === "ready" || status === "leased" || status === "proposed") {
        const taskLabel = typeof task.label === "string" ? task.label.trim().toLowerCase() : "";
        const taskScope = (
          Array.isArray(task.write_scope) ? task.write_scope : []
        ) as readonly string[];
        if (taskLabel === statementLower && scopeConflict(scope, taskScope)) {
          return {
            gateId,
            gateNumber,
            name,
            passed: false,
            reason: `candidate is a duplicate of live task '${taskId}'`,
            repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
          };
        }
      }
    }
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
  };
}

/**
 * Runs all six admission gates in order and stops at the first failure.
 */
export function evaluateAdmissionGates(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionEvaluationResult {
  const verdicts: AdmissionGateVerdict[] = [];

  const gateEvaluators = [
    evaluateGate1Witnessed,
    evaluateGate2InCharter,
    evaluateGate3Falsifiable,
    evaluateGate4Scoped,
    evaluateGate5Affordable,
    evaluateGate6NotADuplicate,
  ];

  for (const evaluator of gateEvaluators) {
    const verdict = evaluator(candidate, context);
    verdicts.push(verdict);
    if (!verdict.passed) {
      return {
        admitted: false,
        candidateId: candidate.id,
        failingGate: verdict,
        verdicts,
        falsifierExitObserved: null,
      };
    }
  }

  const gate3 = verdicts.find((v) => v.gateNumber === 3);
  const falsifierExitObserved =
    gate3?.metadata && typeof gate3.metadata.exitCode === "number"
      ? (gate3.metadata.exitCode as number)
      : null;

  return {
    admitted: true,
    candidateId: candidate.id,
    verdicts,
    falsifierExitObserved,
  };
}
