import type { InvariantAuditResult } from "./types.ts";
import {
  isSupervisorRole,
  inferAgentRole,
  type InvariantContext,
  CODE_EDIT_TOOLS,
  TEST_RUNNER_KEYWORDS,
} from "./helpers.ts";

/**
 * 1. SUPERVISOR_ZERO_CODE_EDITS
 */
export function auditSupervisorZeroCodeEdits(
  ctx: InvariantContext,
  roleMap: Map<string, string>,
): InvariantAuditResult[] {
  const violations: Array<{ agentId: string; role: string; toolOrCommand: string }> = [];

  const rawGrants = ctx.grants ?? (ctx.state?.grants as readonly unknown[] | undefined);
  if (Array.isArray(rawGrants)) {
    for (const grant of rawGrants) {
      if (grant && typeof grant === "object") {
        const g = grant as Record<string, unknown>;
        const id =
          typeof g.id === "string" ? g.id : typeof g.agent_id === "string" ? g.agent_id : "unknown";
        const role = inferAgentRole(id, typeof g.role === "string" ? g.role : undefined, roleMap);
        const toolsUsed = Array.isArray(g.tools_used) ? g.tools_used : [];

        if (isSupervisorRole(role)) {
          for (const tool of toolsUsed) {
            if (typeof tool === "string" && CODE_EDIT_TOOLS.has(tool)) {
              violations.push({ agentId: id, role, toolOrCommand: tool });
            }
          }
        }
      }
    }
  }

  const rawCommands = ctx.commands ?? (ctx.state?.commands as unknown);
  const commandList: Array<Record<string, unknown>> = [];
  if (Array.isArray(rawCommands)) {
    for (const c of rawCommands) {
      if (c && typeof c === "object") commandList.push(c as Record<string, unknown>);
    }
  } else if (rawCommands && typeof rawCommands === "object") {
    for (const c of Object.values(rawCommands as Record<string, unknown>)) {
      if (c && typeof c === "object") commandList.push(c as Record<string, unknown>);
    }
  }

  for (const cmd of commandList) {
    const actor =
      typeof cmd.actor === "string"
        ? cmd.actor
        : typeof cmd.agent_id === "string"
          ? cmd.agent_id
          : undefined;
    const role = inferAgentRole(
      actor,
      typeof cmd.role === "string" ? cmd.role : undefined,
      roleMap,
    );
    const commandLine =
      typeof cmd.command_line === "string"
        ? cmd.command_line
        : typeof cmd.command === "string"
          ? cmd.command
          : "";
    const tool =
      typeof cmd.tool === "string"
        ? cmd.tool
        : typeof cmd.tool_name === "string"
          ? cmd.tool_name
          : undefined;

    if (isSupervisorRole(role)) {
      if (tool && CODE_EDIT_TOOLS.has(tool)) {
        violations.push({ agentId: actor ?? "unknown", role, toolOrCommand: tool });
      }
      if (
        commandLine &&
        (commandLine.includes("write_to_file") || commandLine.includes("replace_file_content"))
      ) {
        violations.push({ agentId: actor ?? "unknown", role, toolOrCommand: commandLine });
      }
    }
  }

  if (Array.isArray(ctx.events)) {
    for (const event of ctx.events) {
      if (event && typeof event === "object") {
        const evt = event as Record<string, unknown>;
        const actor = typeof evt.actor === "string" ? evt.actor : undefined;
        const payload =
          evt.payload && typeof evt.payload === "object"
            ? (evt.payload as Record<string, unknown>)
            : {};
        const agentId = typeof payload.agent_id === "string" ? payload.agent_id : actor;
        const role = inferAgentRole(
          agentId,
          typeof payload.role === "string" ? payload.role : undefined,
          roleMap,
        );
        const toolName =
          typeof payload.tool === "string"
            ? payload.tool
            : typeof payload.tool_name === "string"
              ? payload.tool_name
              : undefined;

        if (isSupervisorRole(role) && toolName && CODE_EDIT_TOOLS.has(toolName)) {
          violations.push({ agentId: agentId ?? "unknown", role, toolOrCommand: toolName });
        }
      }
    }
  }

  if (violations.length > 0) {
    return [
      {
        invariant: "SUPERVISOR_ZERO_CODE_EDITS",
        compliant: false,
        severity: "ERROR",
        message: `Supervisor Zero Code Edits violation: ${violations.length} forbidden code edit action(s) detected by supervisory roles. Supervisors must delegate all code modifications.`,
        details: { violationsCount: violations.length, violations: violations.slice(0, 5) },
      },
    ];
  }

  return [
    {
      invariant: "SUPERVISOR_ZERO_CODE_EDITS",
      compliant: true,
      severity: "INFO",
      message:
        "Supervisor Zero Code Edits invariant satisfied: no supervisory role modified code files.",
    },
  ];
}

/**
 * 2. SUPERVISOR_ZERO_TEST_RUNS
 */
export function auditSupervisorZeroTestRuns(
  ctx: InvariantContext,
  roleMap: Map<string, string>,
): InvariantAuditResult[] {
  const violations: Array<{ agentId: string; role: string; commandLine: string }> = [];

  const rawCommands = ctx.commands ?? (ctx.state?.commands as unknown);
  const commandList: Array<Record<string, unknown>> = [];
  if (Array.isArray(rawCommands)) {
    for (const c of rawCommands) {
      if (c && typeof c === "object") commandList.push(c as Record<string, unknown>);
    }
  } else if (rawCommands && typeof rawCommands === "object") {
    for (const c of Object.values(rawCommands as Record<string, unknown>)) {
      if (c && typeof c === "object") commandList.push(c as Record<string, unknown>);
    }
  }

  for (const cmd of commandList) {
    const actor =
      typeof cmd.actor === "string"
        ? cmd.actor
        : typeof cmd.agent_id === "string"
          ? cmd.agent_id
          : undefined;
    const role = inferAgentRole(
      actor,
      typeof cmd.role === "string" ? cmd.role : undefined,
      roleMap,
    );
    const commandLine =
      typeof cmd.command_line === "string"
        ? cmd.command_line
        : typeof cmd.command === "string"
          ? cmd.command
          : "";

    if (isSupervisorRole(role) && commandLine) {
      const lowerCmd = commandLine.toLowerCase();
      const isTestRun = TEST_RUNNER_KEYWORDS.some((kw) => lowerCmd.includes(kw));
      if (isTestRun) {
        violations.push({ agentId: actor ?? "unknown", role, commandLine });
      }
    }
  }

  if (Array.isArray(ctx.events)) {
    for (const event of ctx.events) {
      if (event && typeof event === "object") {
        const evt = event as Record<string, unknown>;
        const actor = typeof evt.actor === "string" ? evt.actor : undefined;
        const payload =
          evt.payload && typeof evt.payload === "object"
            ? (evt.payload as Record<string, unknown>)
            : {};
        const agentId = typeof payload.agent_id === "string" ? payload.agent_id : actor;
        const role = inferAgentRole(
          agentId,
          typeof payload.role === "string" ? payload.role : undefined,
          roleMap,
        );
        const commandLine =
          typeof payload.command_line === "string"
            ? payload.command_line
            : typeof payload.command === "string"
              ? payload.command
              : "";

        if (isSupervisorRole(role) && commandLine) {
          const lowerCmd = commandLine.toLowerCase();
          const isTestRun = TEST_RUNNER_KEYWORDS.some((kw) => lowerCmd.includes(kw));
          if (isTestRun) {
            violations.push({ agentId: agentId ?? "unknown", role, commandLine });
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    return [
      {
        invariant: "SUPERVISOR_ZERO_TEST_RUNS",
        compliant: false,
        severity: "ERROR",
        message: `Supervisor Zero Test Runs violation: ${violations.length} direct test execution(s) performed by supervisory roles. Supervisors must delegate test execution to validator or implementer.`,
        details: { violationsCount: violations.length, violations: violations.slice(0, 5) },
      },
    ];
  }

  return [
    {
      invariant: "SUPERVISOR_ZERO_TEST_RUNS",
      compliant: true,
      severity: "INFO",
      message:
        "Supervisor Zero Test Runs invariant satisfied: no supervisory role executed test runner commands directly.",
    },
  ];
}

/**
 * 3. THREE_STRIKE_MECHANICAL_CONTAINMENT
 */
export function auditThreeStrikeMechanicalContainment(
  ctx: InvariantContext,
): InvariantAuditResult[] {
  const strikesState = (ctx.state?.strikes ??
    (ctx.state?.mind as Record<string, unknown> | undefined)?.strikes) as
    | Record<string, unknown>
    | undefined;

  if (strikesState && typeof strikesState === "object") {
    for (const [agentId, data] of Object.entries(strikesState)) {
      if (data && typeof data === "object") {
        const count =
          typeof (data as Record<string, unknown>).count === "number"
            ? ((data as Record<string, unknown>).count as number)
            : 0;
        const status =
          typeof (data as Record<string, unknown>).status === "string"
            ? ((data as Record<string, unknown>).status as string)
            : "active";

        if (count >= 3 && (status === "active" || status === "uncontained")) {
          return [
            {
              invariant: "THREE_STRIKE_MECHANICAL_CONTAINMENT",
              compliant: false,
              severity: "ERROR",
              message: `Three-Strike Containment violation: Agent '${agentId}' has ${count} strikes but remains active without persona re-spawn or capability quarantine.`,
              details: { agentId, count, status },
            },
          ];
        }
      }
    }
  }

  return [
    {
      invariant: "THREE_STRIKE_MECHANICAL_CONTAINMENT",
      compliant: true,
      severity: "INFO",
      message:
        "Three-Strike Mechanical Containment invariant satisfied: all strike quotas and escalations properly bounded.",
    },
  ];
}

/**
 * 4. ANTI_MAKEWORK_GENUINE_VALUE
 */
export function auditAntiMakeworkGenuineValue(ctx: InvariantContext): InvariantAuditResult[] {
  const pulse = (ctx.state?.pulse ?? {}) as Record<string, unknown>;
  const consecutiveZeroDelta =
    typeof pulse.consecutive_zero_delta === "number" ? pulse.consecutive_zero_delta : 0;
  const isStagnant = pulse.stagnant === true || pulse.is_stagnant === true;
  const errorCode = typeof pulse.error_code === "string" ? pulse.error_code : undefined;

  const makeworkState = ctx.state?.makework as Record<string, unknown> | undefined;
  if (makeworkState && makeworkState.detected_churn === true) {
    return [
      {
        invariant: "ANTI_MAKEWORK_GENUINE_VALUE",
        compliant: false,
        severity: "ERROR",
        message: `Anti-Make-Work violation: Synthetic churn detected (${typeof makeworkState.reason === "string" ? makeworkState.reason : "cosmetic/abstraction churn"}). Must satisfy 5 Pillars of Genuine Value.`,
        details: { makeworkState },
      },
    ];
  }

  if (isStagnant && errorCode === "MIND_CREATIVE_STAGNATION" && consecutiveZeroDelta >= 3) {
    return [
      {
        invariant: "ANTI_MAKEWORK_GENUINE_VALUE",
        compliant: false,
        severity: "WARN",
        message: `Anti-Make-Work notice: Mind has experienced ${consecutiveZeroDelta} consecutive zero-delta cycles (MIND_CREATIVE_STAGNATION). Autonomic creative overload required.`,
        details: { consecutiveZeroDelta, errorCode },
      },
    ];
  }

  return [
    {
      invariant: "ANTI_MAKEWORK_GENUINE_VALUE",
      compliant: true,
      severity: "INFO",
      message: "Anti-Make-Work 5 Pillars of Genuine Value satisfied: zero cosmetic churn detected.",
    },
  ];
}
