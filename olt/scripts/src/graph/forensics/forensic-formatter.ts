import { computeTaskSlack } from "./critical-path.ts";
import { computeTopologicalWaves, computeWorkSpan } from "./work-span.ts";
import type { ForensicTaskNode } from "./types.ts";

export function renderMermaidDag(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const lines: string[] = ["graph TD"];

  for (const task of tasks) {
    const label =
      task.label !== undefined && task.label.length > 0
        ? `${task.id}["${task.id}: ${task.label}"]`
        : task.id;
    lines.push(`  ${label}`);
  }

  for (const [taskId, prereqs] of dependencies) {
    for (const prereq of prereqs) {
      lines.push(`  ${prereq} --> ${taskId}`);
    }
  }

  return lines.join("\n");
}

export function renderForensicUnicodeReport(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const metrics = computeWorkSpan(tasks, dependencies);
  const slackMap = computeTaskSlack(tasks, dependencies);
  const waves = computeTopologicalWaves(tasks, dependencies);

  const lines: string[] = [
    "╔════════════════════════════════════════════════════════════════════════════════╗",
    "║                       DAG FORENSICS & WORK/SPAN REPORT                         ║",
    "╠════════════════════════════════════════════════════════════════════════════════╣",
    `║ Total Work (W): ${String(metrics.totalWork).padEnd(6)} | Critical Span (S): ${String(metrics.criticalSpan).padEnd(6)} | Concurrency (P): ${String(metrics.parallelismFactor).padEnd(6)} ║`,
    `║ Optimal Lanes:  ${String(metrics.optimalLanes).padEnd(6)} | Total Waves:       ${String(waves.length).padEnd(6)} | Total Tasks:     ${String(tasks.length).padEnd(6)} ║`,
    "╠════════════════════════════════════════════════════════════════════════════════╣",
    `║ Critical Path: [${metrics.criticalPath.join(" -> ")}]`,
    "╠════════════════════════════════════════════════════════════════════════════════╣",
    "║ TASK SLACK & CRITICAL PATH DRAG:                                              ║",
  ];

  for (const task of tasks) {
    const slack = slackMap.get(task.id);
    const est = slack !== undefined ? slack.earliestStartTime : 0;
    const eft = slack !== undefined ? slack.earliestFinishTime : 0;
    const lst = slack !== undefined ? slack.latestStartTime : 0;
    const lft = slack !== undefined ? slack.latestFinishTime : 0;
    const totSlack = slack !== undefined ? slack.totalSlack : 0;
    const isCrit = slack !== undefined ? slack.isCritical : false;

    const dragInfo = metrics.drags.find((d) => d.taskId === task.id);
    const drag = dragInfo !== undefined ? dragInfo.drag : 0;

    const critMark = isCrit ? "[CRITICAL]" : "[SLACK]   ";
    lines.push(
      `║ ${critMark} ${task.id.padEnd(24)} EST:${String(est).padStart(2)} EFT:${String(eft).padStart(2)} LST:${String(lst).padStart(2)} LFT:${String(lft).padStart(2)} Slack:${String(totSlack).padStart(2)} Drag:${String(drag).padStart(2)} ║`,
    );
  }

  if (metrics.fanOutBottlenecks.length > 0) {
    lines.push(
      "╠════════════════════════════════════════════════════════════════════════════════╣",
    );
    lines.push(
      "║ FAN-OUT BOTTLENECKS:                                                           ║",
    );
    for (const b of metrics.fanOutBottlenecks) {
      lines.push(
        `║ ⚠️  Task ${b.taskId} (fan-out: ${b.fanOutCount}, blocked effort: ${b.blockedEffort}, severity: ${b.severity})`,
      );
    }
  }

  if (metrics.queueStalls.length > 0) {
    const artificial = metrics.queueStalls.filter((s) => s.isCriticalStall);
    if (artificial.length > 0) {
      lines.push(
        "╠════════════════════════════════════════════════════════════════════════════════╣",
      );
      lines.push(
        "║ ARTIFICIAL SERIALIZATION & QUEUE STALLS:                                       ║",
      );
      for (const s of artificial) {
        lines.push(
          `║ 🛑 ${s.blockedTaskId} stalled by ${s.blockerTaskId} (${s.stallDuration} units): ${s.recommendation}`,
        );
      }
    }
  }

  lines.push("╚════════════════════════════════════════════════════════════════════════════════╝");
  return lines.join("\n");
}
