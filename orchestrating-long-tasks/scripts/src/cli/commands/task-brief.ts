import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../store/index.ts";
import { readAgentLedger, requireGrant } from "../../workflow/agents/ledger.ts";
import { applicableGates, commandArgv } from "../../workflow/gates/gate-policy.ts";
import { findAssignedWorktree, readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import { formatAgentBrief, type AgentBriefParams } from "../formatters/agent-formatter.ts";
import { formatTaskBrief, type TaskBriefParams } from "../formatters/task-formatter.ts";
import { textFlag, type Flags } from "../options.ts";
import type { TaskRecord } from "../../workflow/types.ts";

/** Helper to extract target files from task write scope or task properties. */
function deriveTargetFiles(
  writeScope: readonly string[],
  taskTargetFiles?: readonly string[],
): readonly string[] {
  if (taskTargetFiles && taskTargetFiles.length > 0) {
    return taskTargetFiles;
  }
  return writeScope.filter((item) => {
    return item.includes(".") || !item.endsWith("/");
  });
}

/** Helper to derive recommended test commands from gate commands and target files. */
function deriveRecommendedCommands(
  gateCommands: readonly string[],
  targetFiles: readonly string[],
): readonly string[] {
  const commands: string[] = [];

  for (const gate of gateCommands) {
    if (
      gate.startsWith("bun test") ||
      gate.startsWith("npm test") ||
      gate.startsWith("cargo test") ||
      gate.startsWith("pytest")
    ) {
      commands.push(gate);
    }
  }

  for (const file of targetFiles) {
    if (
      file.endsWith(".test.ts") ||
      file.endsWith(".spec.ts") ||
      file.endsWith(".test.js") ||
      file.endsWith(".spec.js")
    ) {
      const cmd = `bun test ${file}`;
      if (!commands.includes(cmd)) {
        commands.push(cmd);
      }
    }
  }

  if (commands.length === 0 && gateCommands.length > 0) {
    commands.push(...gateCommands);
  }

  if (commands.length === 0 && targetFiles.length > 0) {
    const candidate = targetFiles[0]!;
    if (candidate.endsWith(".ts") || candidate.endsWith(".js")) {
      commands.push(`bun test ${candidate}`);
    }
  }

  return commands;
}

/** Helper to resolve acceptance criteria from task and state requirements. */
function resolveAcceptanceCriteria(
  stateRequirements: readonly { id: string; status?: string; [key: string]: unknown }[] | undefined,
  requirementIds: readonly string[] | undefined,
  taskAcceptanceCriteria?: readonly string[],
): readonly string[] {
  const criteria: string[] = [];
  if (taskAcceptanceCriteria && taskAcceptanceCriteria.length > 0) {
    criteria.push(...taskAcceptanceCriteria);
  }
  if (requirementIds && requirementIds.length > 0 && stateRequirements) {
    const matched = stateRequirements.filter((r) => requirementIds.includes(r.id));
    for (const req of matched) {
      const title = typeof req.title === "string" ? `: ${req.title}` : "";
      const status = typeof req.status === "string" ? ` [status: ${req.status}]` : "";
      criteria.push(`Requirement \`${req.id}\`${title}${status}`);
    }
  }
  return criteria;
}

/** Helper to derive next action steps based on task status, role, agent, and run. */
function deriveNextSteps(
  run: string,
  taskId: string,
  status: string,
  role?: string,
  agent?: string,
): readonly string[] {
  const steps: string[] = [];
  const agentArg = agent ? ` --agent ${agent}` : " --agent <AGENT>";
  const roleArg = role ? ` --role ${role}` : " --role implementer";

  if (status === "ready" || status === "changes_requested" || status === "retry_ready") {
    steps.push(`bun harness.ts task:claim --run ${run} --task ${taskId}${agentArg}${roleArg}`);
  } else if (status === "leased") {
    steps.push(
      `bun harness.ts task:submit --run ${run} --task ${taskId}${agentArg} --token <TOKEN> --summary "<SUMMARY>"`,
    );
  } else if (status === "submitted") {
    steps.push(
      `bun harness.ts task:validate-start --run ${run} --task ${taskId} --validator <VALIDATOR>`,
    );
  } else if (status === "validating") {
    steps.push(
      `bun harness.ts task:review --run ${run} --task ${taskId} --validator <VALIDATOR> --token <TOKEN> --status pass`,
    );
  }
  return steps;
}

export async function taskBriefCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent", false);
  const role = textFlag(flags, "role", false);

  const loaded = loadRun(run);
  const state = loaded.state;
  const wf = workflowPort(run).read();
  const task = wf.tasks[taskId] ?? (state.tasks as Record<string, TaskRecord> | undefined)?.[taskId];
  if (!task) {
    throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
  }

  const ledger = readWorktreeLedger(state);
  const assigned = ledger ? findAssignedWorktree(ledger, taskId) : null;
  const worktreePath = assigned?.worktreePath;

  const writeScope = task.write_scope ?? [];
  const explicitTargets = Array.isArray(task.target_files)
    ? (task.target_files.filter((item): item is string => typeof item === "string") as readonly string[])
    : undefined;
  const targetFiles = deriveTargetFiles(writeScope, explicitTargets);

  const gates = applicableGates(wf, task);
  const gateCommands = gates.map((gate) => commandArgv(gate.command).join(" "));
  const recommendedCommands = deriveRecommendedCommands(gateCommands, targetFiles);

  const explicitCriteria = Array.isArray(task.acceptance_criteria)
    ? (task.acceptance_criteria.filter((item): item is string => typeof item === "string") as readonly string[])
    : undefined;
  const acceptanceCriteria = resolveAcceptanceCriteria(
    wf.requirements,
    task.requirement_ids,
    explicitCriteria,
  );

  const nextSteps = deriveNextSteps(run, taskId, task.status, role, agent);

  const briefing: TaskBriefParams = {
    taskId,
    label: typeof task.label === "string" ? task.label : undefined,
    role: role ?? (typeof task.role === "string" ? task.role : undefined),
    agent: agent ?? (typeof task.agent === "string" ? task.agent : undefined),
    writeScope,
    worktreePath: worktreePath ?? undefined,
    targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
    recommendedCommands: recommendedCommands.length > 0 ? recommendedCommands : undefined,
    gateCommands: gateCommands.length > 0 ? gateCommands : undefined,
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
  };

  const markdown = formatTaskBrief(briefing);

  return {
    markdown,
    run_root: run,
    task,
    briefing,
  };
}

export async function agentBriefCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const agentId = textFlag(flags, "agent")!;

  const loaded = loadRun(run);
  const state = loaded.state;
  const ledger = readAgentLedger(state);
  const grant = requireGrant(ledger, agentId);

  let writeScope: readonly string[] | undefined;
  let recommendedCommands: readonly string[] | undefined;

  if (grant.parent_task_id) {
    const wf = workflowPort(run).read();
    const parentTask =
      wf.tasks[grant.parent_task_id] ??
      (state.tasks as Record<string, TaskRecord> | undefined)?.[grant.parent_task_id];
    if (parentTask) {
      writeScope = parentTask.write_scope ?? [];
      const explicitTargets = Array.isArray(parentTask.target_files)
        ? (parentTask.target_files.filter(
            (item): item is string => typeof item === "string",
          ) as readonly string[])
        : undefined;
      const targetFiles = deriveTargetFiles(writeScope, explicitTargets);
      const gates = applicableGates(wf, parentTask);
      const gateCommands = gates.map((gate) => commandArgv(gate.command).join(" "));
      recommendedCommands = deriveRecommendedCommands(gateCommands, targetFiles);
    }
  }

  const toolsGranted = grant.tools_granted?.value?.map((t) => t.name) ?? [];

  const briefing: AgentBriefParams = {
    agentId: grant.id,
    role: grant.role,
    parentAgentId: grant.parent_agent_id,
    parentTaskId: grant.parent_task_id,
    model: grant.model?.value !== undefined ? String(grant.model.value) : undefined,
    thinkingLevel:
      grant.thinking_level?.value !== undefined ? String(grant.thinking_level.value) : undefined,
    tools: toolsGranted.length > 0 ? toolsGranted : undefined,
    writeScope,
    recommendedCommands:
      recommendedCommands && recommendedCommands.length > 0 ? recommendedCommands : undefined,
  };

  const markdown = formatAgentBrief(briefing);

  return {
    markdown,
    run_root: run,
    grant,
    briefing,
  };
}
