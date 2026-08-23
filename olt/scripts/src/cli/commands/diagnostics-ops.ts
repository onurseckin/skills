import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_CHECKS, defaultLayout, runHealthCheck } from "../../health/index.ts";
import { renderHealthReport } from "../../health/report.ts";
import type { HealthCheckId } from "../../health/types.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import { constructSupervisoryPersonaReminder } from "../../authority/supervisory-persona-reminder.ts";
import { loadRun, recoverProjection } from "../../engine/store/index.ts";
import { recoverStale } from "../../workflow/lease/recover-stale.ts";
import { releaseLease } from "../../workflow/lease/release.ts";
import { systemClock, type WorkflowState } from "../../workflow/types.ts";
import {
  doctorNextActions,
  enforceLineLimit,
  nextActionsBlock,
  recoverNextActions,
} from "../formatters/index.ts";
import { boolFlag, integerFlag, listFlag, textFlag, type Flags } from "../options.ts";

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

  return {
    ...report,
    persona_reminder: personaReminder,
    markdown: formatDoctorBrief(run, { ...report, persona_reminder: personaReminder }),
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

export function formatDoctorBrief(run: string, report: Record<string, unknown>): string {
  const issues = issueList(report.issues);
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
    ...(issues.length > 0 ? ["- **Issues**:"] : ["- **Issues**: none"]),
    ...issues.map((issue) => `  - ${issue}`),
    ...nextActionsBlock(doctorNextActions(run)),
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
    tasks: state.tasks,
  };
}

export function repairProjectionCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const state = recoverProjection(run, actor);
  const lastEvent = loadRun(run).events.at(-1);
  const quarantined = lastEvent?.payload.quarantined_torn_tail === true;
  const lines = [
    `### Projection Repaired: \`${run}\``,
    `- **Actor**: ${actor}`,
    `- **Event Sequence**: ${state.event_sequence}`,
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

function isCheckId(name: string): name is HealthCheckId {
  const known: readonly string[] = ALL_CHECKS;
  return known.includes(name);
}

function requestedChecks(flags: Flags): readonly HealthCheckId[] {
  const requested = listFlag(flags, "check");
  if (requested === undefined) return ALL_CHECKS;
  const unknown = requested.filter((name) => !isCheckId(name));
  if (unknown.length > 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `unknown --check: ${unknown.join(", ")}; known checks are ${ALL_CHECKS.join(", ")}`,
    );
  }
  return requested.filter(isCheckId);
}

export function healthCommand(flags: Flags): Record<string, unknown> {
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
  const report = runHealthCheck(layout, requestedChecks(flags));
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
