import { existsSync } from "node:fs";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import {
  buildExactAnchorBriefing,
  extractFileAnchors,
  type ExactAnchor,
  type ExactAnchorBriefing,
} from "../../mind/briefing-builder.ts";
import { loadRun } from "../../engine/store/index.ts";
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
  const rawTaskId = textFlag(flags, "task", false);
  const agentId = textFlag(flags, "agent", false);
  const role = textFlag(flags, "role", false);

  if (!rawTaskId && !agentId) {
    throw new HarnessError("INVALID_ARGUMENT", "Must provide at least --task or --agent");
  }

  const loaded = loadRun(run);
  const state = loaded.state;
  const wf = workflowPort(run).read();

  let agentGrant: any = undefined;
  let taskId = rawTaskId;

  if (agentId) {
    const ledger = readAgentLedger(state);
    agentGrant = requireGrant(ledger, agentId);
    if (!taskId && agentGrant.parent_task_id) {
      taskId = agentGrant.parent_task_id;
    }
  }

  let task: TaskRecord | undefined = undefined;
  if (taskId) {
    task =
      wf.tasks[taskId] !== undefined
        ? wf.tasks[taskId]
        : (state.tasks as Record<string, TaskRecord> | undefined)?.[taskId];
    if (!task && rawTaskId) {
      throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
    }
  }

  let combinedMarkdown = "";
  let agentBriefing: AgentBriefParams | undefined = undefined;
  let recommendedCommands: string[] = [];

  // Build task briefing first if we have a task
  let exactAnchorBriefing: ExactAnchorBriefing | undefined = undefined;
  let legacyBriefing: TaskBriefParams | undefined = undefined;

  if (task && taskId) {
    const ledger = readWorktreeLedger(state);
    const assigned = ledger !== null ? findAssignedWorktree(ledger, taskId) : null;
    const worktreePath = assigned !== null ? assigned.worktreePath : undefined;

    const writeScope = task.write_scope !== undefined ? task.write_scope : [];
    const explicitTargets = Array.isArray(task.target_files)
      ? (task.target_files.filter(
          (item): item is string => typeof item === "string",
        ) as readonly string[])
      : undefined;
    const targetFiles = deriveTargetFiles(writeScope, explicitTargets);

    const gates = applicableGates(wf, task);
    const gateCommands = gates.map((gate) => commandArgv(gate.command).join(" "));
    recommendedCommands = deriveRecommendedCommands(gateCommands, targetFiles) as string[];

    const explicitCriteria = Array.isArray(task.acceptance_criteria)
      ? (task.acceptance_criteria.filter(
          (item): item is string => typeof item === "string",
        ) as readonly string[])
      : undefined;
    const acceptanceCriteria = resolveAcceptanceCriteria(
      wf.requirements,
      task.requirement_ids,
      explicitCriteria,
    );

    const nextSteps = deriveNextSteps(
      run,
      taskId,
      task.status,
      role || undefined,
      agentId || undefined,
    );

    const resolvedRole =
      role !== undefined ? role : typeof task.role === "string" ? task.role : undefined;
    const resolvedAgent =
      agentId !== undefined ? agentId : typeof task.agent === "string" ? task.agent : undefined;

    const explicitSymbols = Array.isArray(task.target_symbols)
      ? (task.target_symbols.filter(
          (item): item is string => typeof item === "string",
        ) as readonly string[])
      : undefined;

    const baseDir =
      worktreePath !== undefined && existsSync(worktreePath) ? worktreePath : undefined;

    const label =
      typeof task.label === "string"
        ? task.label
        : typeof task.title === "string"
          ? task.title
          : taskId;

    exactAnchorBriefing = buildExactAnchorBriefing({
      taskId,
      label,
      writeScope,
      targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
      targetSymbols: explicitSymbols,
      gateCommands: gateCommands.length > 0 ? gateCommands : undefined,
      acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
      recommendedCommands: recommendedCommands.length > 0 ? recommendedCommands : undefined,
      baseDir,
    });

    legacyBriefing = {
      taskId,
      label: typeof task.label === "string" ? task.label : undefined,
      role: resolvedRole,
      agent: resolvedAgent,
      writeScope,
      worktreePath: worktreePath !== undefined ? worktreePath : undefined,
      targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
      recommendedCommands: recommendedCommands.length > 0 ? recommendedCommands : undefined,
      gateCommands: gateCommands.length > 0 ? gateCommands : undefined,
      acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
      nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
    };
  }

  if (agentGrant && agentId) {
    const toolsGranted =
      agentGrant.tools_granted?.value !== undefined
        ? agentGrant.tools_granted.value.map((t: any) => t.name)
        : [];
    agentBriefing = {
      agentId: agentGrant.id,
      role: agentGrant.role,
      parentAgentId: agentGrant.parent_agent_id,
      parentTaskId: agentGrant.parent_task_id,
      model: agentGrant.model?.value !== undefined ? String(agentGrant.model.value) : undefined,
      thinkingLevel:
        agentGrant.thinking_level?.value !== undefined
          ? String(agentGrant.thinking_level.value)
          : undefined,
      tools: toolsGranted.length > 0 ? toolsGranted : undefined,
      writeScope: task?.write_scope,
      recommendedCommands: recommendedCommands.length > 0 ? recommendedCommands : undefined,
    };
    combinedMarkdown += formatAgentBrief(agentBriefing);
  }

  if (exactAnchorBriefing) {
    if (combinedMarkdown.length > 0) {
      combinedMarkdown += "\n\n---\n\n";
    }
    combinedMarkdown += exactAnchorBriefing.markdown;
  }

  return {
    markdown: combinedMarkdown,
    run_root: run,
    task,
    grant: agentGrant,
    briefing: legacyBriefing,
    agent_briefing: agentBriefing,
    exact_anchor_briefing: exactAnchorBriefing,
    anchors: exactAnchorBriefing?.anchors,
    symbols: exactAnchorBriefing?.symbols,
  };
}
