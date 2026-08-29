import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import { constructSupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import { loadRun, recoverProjection, transactionRecoveryStatus } from "../../engine/store/index.ts";
import { recoverStale } from "../../workflow/lease/recover-stale.ts";
import { releaseLease } from "../../workflow/lease/release.ts";
import { systemClock, type WorkflowState } from "../../workflow/types.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import {
  doctorNextActions,
  nextActionsBlock,
  recoverNextActions,
  type DoctorCriticalFinding,
} from "../formatters/next-actions.ts";
import { boolFlag, integerFlag, listFlag, textFlag, type Flags } from "../options.ts";

function runPlanVerified(run: string): boolean {
  try {
    const { state } = loadRun(run);
    const tasks = isJsonObject(state.tasks) ? state.tasks : undefined;
    const hasTasks = tasks !== undefined && Object.keys(tasks).length > 0;
    return hasTasks || Boolean(state.graph) || Boolean(state.completion_review);
  } catch {
    return false;
  }
}

function criticalTierFindings(report: Record<string, unknown>): DoctorCriticalFinding[] {
  const raw = report.tier_confinement_findings;
  if (!Array.isArray(raw)) return [];
  const findings: DoctorCriticalFinding[] = [];
  for (const entry of raw) {
    if (!isJsonObject(entry)) continue;
    if (entry.severity === "minor") continue;
    const role = typeof entry.role === "string" ? entry.role : "";
    const agentId = typeof entry.agent_id === "string" ? entry.agent_id : "";
    const remediation = typeof entry.remediation === "string" ? entry.remediation : "";
    if (!role || !agentId || !remediation) continue;
    const evidence = isJsonObject(entry.evidence) ? entry.evidence : undefined;
    const taskId = typeof evidence?.task_id === "string" ? evidence.task_id : undefined;
    findings.push({ role, agentId, remediation, taskId });
  }
  return findings;
}

export async function doctorCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const source = textFlag(flags, "source", false);
  const home = textFlag(flags, "home", false);
  const clients = textFlag(flags, "clients", false);
  const actor = textFlag(flags, "actor", false) ?? "coordinator";
  const role = textFlag(flags, "role", false) ?? "coordinator";
  const installation =
    source !== undefined && home !== undefined
      ? {
          installation: {
            source,
            home,
            ...(clients === undefined
              ? {}
              : {
                  clients: clients
                    .split(",")
                    .map((name) => name.trim())
                    .filter(Boolean),
                }),
          },
        }
      : {};

  const report = await runDoctor(run, installation);
  const planVerified = runPlanVerified(run);
  const personaReminder = constructSupervisoryPersonaReminder({
    role,
    agentId: actor,
    runId: run,
    context: {
      role,
      agentId: actor,
      runId: run,
      failedGatesCount: (report.workflow_issues as unknown[])?.length ?? 0,
      openFindingsCount: (report.behavioral_findings as unknown[])?.length ?? 0,
    },
  });

  const reportWithReadiness = { ...report, plan_verified: planVerified };

  return {
    ...reportWithReadiness,
    persona_reminder: personaReminder,
    markdown: formatDoctorBrief(run, { ...reportWithReadiness, persona_reminder: personaReminder }),
  };
}

function ternary(value: unknown, whenTrue: string, whenFalse: string): string {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return "unknown";
}

function issueList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: readonly unknown[] = value;
  return entries.filter((issue): issue is string => typeof issue === "string");
}

// runDoctor (reporting/doctor.ts) tiers issues into critical_issues/cosmetic_issues so
// Healthy reflects only critical findings while cosmetic layout noise (e.g. an
// undeclared capsule entry) stays visible but does not bury the one line that matters.
// A caller carrying only the legacy flat `issues` field (any older report shape, or a
// direct unit-test call) still renders exactly as before — this is additive, not a
// breaking rendering change.
function hasTieredIssueFields(report: Record<string, unknown>): boolean {
  if (Array.isArray(report.critical_issues)) return true;
  if (Array.isArray(report.cosmetic_issues)) return true;
  return false;
}

function issueSectionLines(report: Record<string, unknown>): string[] {
  if (!hasTieredIssueFields(report)) {
    const issues = issueList(report.issues);
    return [
      ...(issues.length > 0 ? ["- **Issues**:"] : ["- **Issues**: none"]),
      ...issues.map((issue) => `  - ${issue}`),
    ];
  }
  const criticalIssues = issueList(report.critical_issues);
  const cosmeticIssues = issueList(report.cosmetic_issues);
  const autoHealed = Array.isArray(report.auto_healed) ? issueList(report.auto_healed) : [];
  const warnings = Array.isArray(report.warnings) ? issueList(report.warnings) : [];
  const infos = [...autoHealed.map((msg) => `Auto-Healed: ${msg}`), ...cosmeticIssues];

  return [
    ...(criticalIssues.length > 0 ? ["- **Critical Issues**:"] : ["- **Critical Issues**: none"]),
    ...criticalIssues.map((issue) => `  - ${issue}`),
    ...(infos.length > 0
      ? [
          "- **Notices** (cosmetic — do not affect Healthy):",
          ...infos.map((issue) => `  - ${issue}`),
        ]
      : []),
    "",
    "### Doctor Findings:",
    `- **[ERROR]**:`,
    ...(criticalIssues.length > 0 ? criticalIssues.map((e) => `  - ${e}`) : ["  - none"]),
    `- **[WARN]**:`,
    ...(warnings.length > 0 ? warnings.map((w) => `  - ${w}`) : ["  - none"]),
    `- **[INFO]**:`,
    ...(infos.length > 0 ? infos.map((i) => `  - ${i}`) : ["  - none"]),
  ];
}

export function formatDoctorBrief(run: string, report: Record<string, unknown>): string {
  const bunVersion =
    typeof report.bun_version === "string" && report.bun_version.trim()
      ? report.bun_version
      : "unknown";
  const lines = [
    `### Capsule Doctor: \`${run}\``,
    `- **Healthy**: ${ternary(report.healthy, "yes", "no")}`,
    `- **Bun**: ${bunVersion} (${ternary(report.bun_supported, "supported", "unsupported")})`,
    `- **Gitignored**: ${ternary(report.gitignored, "yes", "no")}`,
    `- **Supervisory Invariants**: Strict Tier Hierarchy & Supervisor Zero-File-Edit Rule actively enforced`,
    `- **Git Preservation**: Zero-Destructive Git Invariant & User Edit Preservation actively enforced`,
    ...issueSectionLines(report),
    ...nextActionsBlock(
      doctorNextActions(run, {
        healthy: report.healthy === true,
        planVerified: typeof report.plan_verified === "boolean" ? report.plan_verified : true,
        criticalFindings: criticalTierFindings(report),
      }),
    ),
  ];
  return enforceLineLimit(lines.join("\n"));
}

function leasedSubTasks(state: WorkflowState): string[] {
  return (state.branches ?? [])
    .flatMap((branch) => branch.sub_tasks)
    .filter((subTask) => subTask.lease !== undefined)
    .map((subTask) => subTask.id);
}

export function recoverCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const graceSeconds = integerFlag(flags, "grace-seconds", { minimum: 0, maximum: 86_400 });
  const pendingPhase = transactionRecoveryStatus(run);

  const port = workflowPort(run);
  const before = port.read();
  const leasedBefore = Object.values(before.tasks)
    .filter((task) => task.lease !== undefined)
    .map((task) => task.id);
  const subLeasedBefore = leasedSubTasks(before);
  const state = recoverStale(
    port,
    actor,
    systemClock,
    graceSeconds === undefined ? {} : { graceSeconds },
  );
  const recovered = leasedBefore.filter((id) => state.tasks[id]?.lease === undefined);
  const stillSubLeased = new Set(leasedSubTasks(state));
  const recoveredSubTasks = subLeasedBefore.filter((id) => !stillSubLeased.has(id));

  const lines = [
    `### Stale Lease Recovery: \`${run}\``,
    `- **Actor**: ${actor}`,
    `- **Transaction Recovery**: ${pendingPhase === undefined ? "not pending" : pendingPhase}`,
    `- **Leases Released**: ${recovered.length}`,
    ...recovered.map((id) => `  - \`${id}\` -> ${state.tasks[id]?.status ?? "unknown"}`),
    `- **Branch Sub-leases Reclaimed**: ${recoveredSubTasks.length}`,
    ...recoveredSubTasks.map((id) => `  - \`${id}\` -> open`),
    ...nextActionsBlock(recoverNextActions(run)),
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    run_root: run,
    recovered,
    recovered_sub_tasks: recoveredSubTasks,
    transaction_recovery_phase: pendingPhase,
    tasks: state.tasks,
  };
}

export function repairProjectionCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const pendingPhase = transactionRecoveryStatus(run);
  const state = recoverProjection(run, actor);
  const lastEvent = loadRun(run).events.at(-1);
  const quarantined = lastEvent?.payload.quarantined_torn_tail === true;
  const lines = [
    `### Projection Repaired: \`${run}\``,
    `- **Actor**: ${actor}`,
    `- **Event Sequence**: ${state.event_sequence}`,
    `- **Transaction Recovery**: ${pendingPhase === undefined ? "not pending" : pendingPhase}`,
    `- **Torn Tail Quarantined**: ${quarantined ? "yes" : "no"}`,
    ...nextActionsBlock([
      {
        command: `bun harness.ts run:status --run ${run}`,
        role: "Orchestrator",
        description: "Verify state projection integrity",
      },
    ]),
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    run_root: run,
    state,
    transaction_recovery_phase: pendingPhase,
    quarantined_torn_tail: quarantined,
  };
}

export function taskReleaseCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const state = releaseLease(workflowPort(run), taskId, agent, textFlag(flags, "token")!);
  const task = state.tasks[taskId]!;
  const lines = [
    `### Lease Released: \`${taskId}\``,
    `- **Agent**: \`${agent}\``,
    `- **Task Status**: ${task.status}`,
    `- **Reclaim**: \`bun harness.ts task:claim --run ${run} --task ${taskId} --agent <AGENT>\``,
    ...nextActionsBlock([
      {
        command: `bun harness.ts task:claim --run ${run} --task ${taskId} --agent <AGENT>`,
        role: "Implementer",
        description: "Reclaim released task lease",
      },
    ]),
  ];
  return { markdown: enforceLineLimit(lines.join("\n")), run_root: run, task };
}

function existingDirectory(flags: Flags, name: string): string | undefined {
  const value = textFlag(flags, name, false);
  if (value === undefined) return undefined;
  const path = resolve(value);
  if (!existsSync(path)) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} does not exist: ${path}`);
  }
  return path;
}

export async function healthCommand(flags: Flags): Promise<Record<string, unknown>> {
  const { ALL_CHECKS, defaultLayout, runHealthCheck } = await import("../../health/index.ts");
  const { renderHealthReport } = await import("../../health/report.ts");
  type HealthCheckId = (typeof ALL_CHECKS)[number];
  const isCheckId = (name: string): name is HealthCheckId =>
    (ALL_CHECKS as readonly string[]).includes(name);

  const scripts = existingDirectory(flags, "scripts");
  const consumer = existingDirectory(flags, "consumer");
  const base = defaultLayout(scripts);
  if (!existsSync(resolve(base.scriptsRoot, "src"))) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `no src directory under ${base.scriptsRoot}; --scripts must name a harness scripts root`,
    );
  }
  const layout = consumer === undefined ? base : { ...base, consumerRoot: consumer };
  const requested = listFlag(flags, "check");
  let checksToRun: readonly HealthCheckId[] = ALL_CHECKS;
  if (requested !== undefined) {
    const unknown = requested.filter((name) => !isCheckId(name));
    if (unknown.length > 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `unknown --check: ${unknown.join(", ")}; known checks are ${ALL_CHECKS.join(", ")}`,
      );
    }
    checksToRun = requested.filter(isCheckId);
  }
  const report = runHealthCheck(layout, checksToRun);
  if (boolFlag(flags, "strict") && !report.healthy) {
    throw new HarnessError(
      "INVALID_STATE",
      `semantic health check failed: ${report.failure_count} failure(s)`,
    );
  }
  return {
    ...report,
    run_root: layout.repoRoot,
    markdown: renderHealthReport(report, layout.repoRoot, boolFlag(flags, "all")),
  };
}
