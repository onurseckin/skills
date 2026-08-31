/** Helper to extract target files from task write scope or task properties. */
export function deriveTargetFiles(
  writeScope: readonly string[],
  taskTargetFiles?: readonly string[],
): readonly string[] {
  if (taskTargetFiles && taskTargetFiles.length > 0) {
    return taskTargetFiles;
  }
  return writeScope.filter((item) => {
    return /\.[a-zA-Z0-9_-]+$/.test(item);
  });
}

/** Helper to derive recommended test commands from gate commands and target files. */
export function deriveRecommendedCommands(
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
export function resolveAcceptanceCriteria(
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
      const text =
        typeof req.title === "string" && req.title.trim()
          ? req.title
          : typeof req.statement === "string" && req.statement.trim()
            ? req.statement
            : typeof req.description === "string" && req.description.trim()
              ? req.description
              : "";
      const title = text ? `: ${text}` : "";
      const status = typeof req.status === "string" ? ` [status: ${req.status}]` : "";
      criteria.push(`Requirement \`${req.id}\`${title}${status}`);
    }
  }
  if (criteria.length === 0) {
    criteria.push(
      "Strict adherence to project architecture.",
      "Code passes all lint and typecheck rules.",
      "Strict type safety: 0 'any' types, 0 compiler suppressions (@ts-ignore, @ts-expect-error, eslint-disable).",
    );
  }
  return criteria;
}

/** Helper to derive next action steps based on task status, role, agent, and run. */
export function deriveNextSteps(
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
