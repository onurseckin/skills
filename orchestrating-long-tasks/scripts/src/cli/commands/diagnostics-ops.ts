import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_CHECKS, defaultLayout, runHealthCheck } from "../../health/index.ts";
import { renderHealthReport } from "../../health/report.ts";
import type { HealthCheckId } from "../../health/types.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import { loadRun, recoverProjection } from "../../store/index.ts";
import { recoverStale } from "../../workflow/lease/recover-stale.ts";
import { releaseLease } from "../../workflow/lease/release.ts";
import { systemClock, type WorkflowState } from "../../workflow/types.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, integerFlag, listFlag, textFlag, type Flags } from "../options.ts";

export async function doctorCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const source = textFlag(flags, "source", false);
  const home = textFlag(flags, "home", false);
  const clients = textFlag(flags, "clients", false);
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
  return { ...report, markdown: formatDoctorBrief(run, report) };
}

// A field the report never produced must read as "unknown"; rendering it as "no" or "undefined"
// would present an absent measurement as a measured one.
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
    ...(issues.length > 0 ? ["- **Issues**:"] : ["- **Issues**: none"]),
    ...issues.map((issue) => `  - ${issue}`),
  ];
  return enforceLineLimit(lines.join("\n"));
}

/** Sub-task ids a branch is still holding a live sub-lease for, before and after recovery. */
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
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    run_root: run,
    recovered,
    recovered_sub_tasks: recoveredSubTasks,
    tasks: state.tasks,
  };
}

/**
 * `doctor` only reports a torn tail or a state/event mismatch; this is the repair. It re-derives
 * `state.json` from the event chain's valid prefix and quarantines whatever a crash left dangling
 * off the end, so a run interrupted mid-write can resume instead of every later command throwing on
 * the same integrity check `doctor` just used to diagnose it.
 */
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
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    run_root: run,
    state,
    quarantined_torn_tail: quarantined,
  };
}

/**
 * The manual counterpart to `recover`: an agent that knows it is walking away hands the lease back
 * instead of leaving the task frozen until the clock runs out.
 */
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

/**
 * The semantic health check (B9.2). It reads the tree it is pointed at rather than any capsule: the
 * question is whether the code does what the requirements said, which no run can answer.
 */
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
