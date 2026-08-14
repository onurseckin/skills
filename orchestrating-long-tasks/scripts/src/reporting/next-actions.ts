import type { JsonObject } from "../contracts/json.ts";
import { type CommandView, type GateView, type PacketView, type TaskView } from "./action-types.ts";
import { completionActions } from "./completion-actions.ts";
import { taskActions } from "./task-actions.ts";

export function nextArgv(runRoot: string, runtime: string, view: JsonObject): string[][] {
  const prefix = ["bun", runtime];
  const commands = [
    [...prefix, "status", "--run", runRoot],
    [...prefix, "doctor", "--run", runRoot],
  ];
  const staleEvidence = Array.isArray(view.stale_evidence) ? view.stale_evidence : [];
  if (staleEvidence.length > 0) {
    commands.push([
      ...prefix,
      "recover",
      "--run",
      runRoot,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    return commands;
  }
  const tasks = view.tasks as unknown as TaskView[];
  const requirements = Array.isArray(view.requirements)
    ? (view.requirements as Record<string, unknown>[])
    : [];
  const pausedRequirementIds = new Set(
    requirements
      .filter(
        ({ disposition, authority_status }) =>
          disposition === "needs_authority" && authority_status === null,
      )
      .map(({ id }) => String(id)),
  );
  for (const requirementId of [...pausedRequirementIds].sort()) {
    commands.push([
      ...prefix,
      "decide-authority",
      "--run",
      runRoot,
      "--requirement",
      requirementId,
      "--actor",
      "coordinator",
      "--decision",
      "<grant-or-decline>",
      "--rationale",
      `<authority-rationale-for:${requirementId}>`,
    ]);
  }
  const gates = view.gates as unknown as GateView[];
  const packets = view.packets as unknown as PacketView[];
  const records = view.commands as unknown as CommandView[];
  if (
    tasks.some(
      ({ status, requirement_ids: ids }) =>
        (status === "ready" || status === "proposed" || status === "retry_ready") &&
        !ids.some((id) => pausedRequirementIds.has(id)),
    )
  ) {
    commands.push([...prefix, "ready", "--run", runRoot, "--max-parallel", "1"]);
    commands.push([
      ...prefix,
      "schedule",
      "--run",
      runRoot,
      "--max-parallel",
      "1",
      "--actor",
      "coordinator",
    ]);
  }
  for (const task of tasks)
    if (!task.requirement_ids.some((id) => pausedRequirementIds.has(id)))
      commands.push(...taskActions(prefix, runRoot, task, gates, packets));
  if (tasks.length > 0 && tasks.every(({ status }) => status === "done")) {
    commands.push(...completionActions(prefix, runRoot, view, gates, records));
  }
  return commands;
}
