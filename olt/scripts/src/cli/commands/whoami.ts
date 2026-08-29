import { integerFlag, textFlag, type Flags } from "../options.ts";
import { enforceLineLimit, nextActionsBlock, whoamiNextActions } from "../formatters/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { identifyExecutionContext, parseTierValue } from "../../authority/thread/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import {
  constructSupervisoryPersonaReminder,
  type SupervisoryPersonaReminder,
} from "../../authority/supervisory/index.ts";

export interface TaskLeaseSummary {
  task_id: string;
  agent_id: string;
  role: string;
  expires_at: string;
  status: string;
}

export interface TaskValidationSummary {
  task_id: string;
  validator_id: string;
  domain: string;
  deadline_at: string;
}

function parseOptionalInt(flags: Flags, name: string, minimum = 0): number | undefined {
  const raw: unknown = flags[name];
  if (raw === undefined) return undefined;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= minimum) return raw;
  return integerFlag(flags, name, { minimum });
}

function parseOptionalText(flags: Flags, name: string): string | undefined {
  const raw: unknown = flags[name];
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return textFlag(flags, name, false);
  return undefined;
}

export function whoamiCommand(flags: Flags): Record<string, unknown> {
  const run = parseOptionalText(flags, "run") ?? null;
  const agentOverride = parseOptionalText(flags, "agent");
  const roleOverride = parseOptionalText(flags, "role");
  const tierOverride = parseOptionalText(flags, "tier");
  const pidOverride = parseOptionalInt(flags, "pid", 1);
  const ppidOverride = parseOptionalInt(flags, "ppid", 0);

  const parsedTier =
    tierOverride !== undefined ? (parseTierValue(tierOverride) ?? undefined) : undefined;

  const thread = identifyExecutionContext({
    ...(pidOverride !== undefined ? { pid: pidOverride } : {}),
    ...(ppidOverride !== undefined ? { ppid: ppidOverride } : {}),
    ...(agentOverride !== undefined ? { agentId: agentOverride } : {}),
    ...(roleOverride !== undefined ? { role: roleOverride } : {}),
    ...(parsedTier !== undefined ? { tier: parsedTier } : {}),
    ...(run !== null ? { runRoot: run } : {}),
  });

  const activeAgentId = agentOverride ?? thread.agent_id;

  let activeGrants: AgentGrantRecord[] = [];
  const activeLeases: TaskLeaseSummary[] = [];
  const activeValidations: TaskValidationSummary[] = [];
  let runStateLoaded = false;

  if (run !== null) {
    try {
      const loaded = loadRun(run);
      const state = loaded.state;
      const ledger = readAgentLedger(state);
      activeGrants = ledger.filter((grant) => grant.status === "active");
      runStateLoaded = true;

      if (isJsonObject(state.tasks)) {
        for (const [taskId, rawTask] of Object.entries(state.tasks)) {
          if (!isJsonObject(rawTask)) continue;
          const lease = rawTask.lease;
          if (isJsonObject(lease)) {
            const leaseAgentId = typeof lease.agent_id === "string" ? lease.agent_id : "";
            const leaseRole = typeof lease.role === "string" ? lease.role : "";
            const leaseExpires = typeof lease.expires_at === "string" ? lease.expires_at : "";
            const taskStatus = typeof rawTask.status === "string" ? rawTask.status : "leased";
            activeLeases.push({
              task_id: taskId,
              agent_id: leaseAgentId,
              role: leaseRole,
              expires_at: leaseExpires,
              status: taskStatus,
            });
          }
          if (Array.isArray(rawTask.validations)) {
            for (const rawValidation of rawTask.validations) {
              if (!isJsonObject(rawValidation)) continue;
              const validatorId =
                typeof rawValidation.validator_id === "string" ? rawValidation.validator_id : "";
              activeValidations.push({
                task_id: taskId,
                validator_id: validatorId,
                domain: typeof rawValidation.domain === "string" ? rawValidation.domain : "",
                deadline_at:
                  typeof rawValidation.deadline_at === "string" ? rawValidation.deadline_at : "",
              });
            }
          }
        }
      }
    } catch {
      // If run fails to load or does not exist, proceed with thread info alone
    }
  }

  const filteredGrants = activeAgentId
    ? activeGrants.filter((grant) => grant.id === activeAgentId)
    : activeGrants;

  const filteredLeases = activeAgentId
    ? activeLeases.filter((lease) => lease.agent_id === activeAgentId)
    : activeLeases;

  const filteredValidations = activeAgentId
    ? activeValidations.filter((validation) => validation.validator_id === activeAgentId)
    : activeValidations;

  const effectiveRole =
    roleOverride ??
    thread.role ??
    (thread.tier === 0
      ? "mind"
      : thread.tier === 1
        ? "orchestrator"
        : thread.tier === 2
          ? "coordinator"
          : "implementer");

  const tickOverride = parseOptionalInt(flags, "tick", 1);
  const cadenceOverride = parseOptionalInt(flags, "cadence-ms", 1000);

  const personaReminder: SupervisoryPersonaReminder = constructSupervisoryPersonaReminder({
    role: effectiveRole,
    agentId: activeAgentId ?? thread.agent_id ?? undefined,
    runId: run,
    tickNumber: tickOverride,
    cadenceMs: cadenceOverride,
    context: {
      role: effectiveRole,
      agentId: activeAgentId ?? thread.agent_id ?? undefined,
      runId: run,
      isMainThread: thread.is_main_thread,
      activeLeases: filteredLeases.map((l) => ({
        taskId: l.task_id,
        agentId: l.agent_id,
        role: l.role,
      })),
    },
  });

  const mdLines: string[] = [
    `### Thread Authority Identification (\`whoami\`)`,
    `- **PID / PPID**: \`${thread.pid}\` / \`${thread.ppid}\``,
    `- **Execution Tier**: \`${thread.is_main_thread ? "Main Interactive Agent Thread" : `Tier ${thread.tier}`}\` (${thread.tier_name})`,
    `- **Active Agent**: \`${activeAgentId ?? thread.agent_id ?? "none"}\`${thread.role ? ` (role: \`${thread.role}\`)` : ""}`,
    `- **Compliance**: \`${thread.compliance_state.toUpperCase()}\``,
    `- **Host App**: \`${thread.host_profile.app_id}\``,
    `- **OS Platform**: \`${thread.host_profile.os_platform} ${thread.host_profile.os_release} (${thread.host_profile.os_arch})\``,
    `- **Runtime**: \`${thread.host_profile.runtime_bun ? `bun ${thread.host_profile.runtime_bun}` : `node ${thread.host_profile.runtime_node}`}\``,
    `- **Taxonomy**: \`${thread.capabilities.command_taxonomy}\``,
  ];

  if (thread.capabilities.tools.length > 0) {
    mdLines.push(`- **Tools**: ${thread.capabilities.tools.join(", ")}`);
  }
  if (thread.capabilities.environment_grants.length > 0) {
    mdLines.push(`- **Environment Grants**: ${thread.capabilities.environment_grants.join(", ")}`);
  }

  if (thread.advisory) {
    mdLines.push(`- **Advisory**: ⚠️ ${thread.advisory}`);
  }

  if (
    thread.tier === 0 ||
    thread.tier === 1 ||
    thread.tier === 2 ||
    thread.is_main_thread ||
    (thread.role &&
      (thread.role.startsWith("orch") ||
        thread.role.startsWith("coord") ||
        thread.role.startsWith("mind")))
  ) {
    mdLines.push(
      `- **ROLE INVARIANT**: 🚫 SUPERVISOR ROLE DETECTED (Tier ${thread.tier}). You are strictly forbidden from calling code-editing tools (\`write_to_file\`, \`replace_file_content\`). All code implementation and test execution MUST be delegated to Tier 3 subagents via \`invoke_subagent\`.`,
    );
    mdLines.push(
      `- **SUPERVISORY PERSONA**: [${personaReminder.persona.displayName}] Role=\`${effectiveRole.toUpperCase()}\` (Tier ${personaReminder.tier}). Mandate: ${personaReminder.persona.coreMandate}`,
    );
    mdLines.push(
      `- **SUPERVISORY INVARIANTS**: Strict 4-Tier Spawning Hierarchy & Zero-File-Edit Invariant actively enforced.`,
    );
    if (personaReminder.correctiveDirectives.length > 0) {
      mdLines.push(
        `- **CORRECTIVE DIRECTIVES**: ${personaReminder.correctiveDirectives.join(" | ")}`,
      );
    }
  } else {
    mdLines.push(
      `- **PERSONA REMINDER**: [${personaReminder.persona.displayName}] Role=\`${effectiveRole.toUpperCase()}\` (Tier ${personaReminder.tier}). Mandate: ${personaReminder.persona.coreMandate}`,
    );
  }

  if (thread.defect) {
    mdLines.push(`- **Defect Logged**: \`${thread.defect.id}\` (${thread.defect.type})`);
  }

  if (run !== null) {
    mdLines.push(`- **Run Root**: \`${run}\``);
    mdLines.push(
      `- **Active Grants**: \`${filteredGrants.length}\` active (total run active: \`${activeGrants.length}\`)`,
    );
    mdLines.push(
      `- **Active Leases**: \`${filteredLeases.length}\` held (total run leases: \`${activeLeases.length}\`)`,
    );

    if (filteredLeases.length > 0) {
      mdLines.push(`- **Held Tasks**: ${filteredLeases.map((l) => `\`${l.task_id}\``).join(", ")}`);
    }

    if (filteredValidations.length > 0) {
      mdLines.push(
        `- **Open Validations**: ${filteredValidations.map((v) => `\`${v.task_id}\``).join(", ")}`,
      );
    }
  }

  mdLines.push(
    ...nextActionsBlock(
      whoamiNextActions(run, thread.is_main_thread, {
        role: effectiveRole,
        agentId: activeAgentId ?? thread.agent_id ?? undefined,
        hasGrant: runStateLoaded ? filteredGrants.length > 0 : undefined,
        leases: filteredLeases.map((l) => ({ taskId: l.task_id, role: l.role })),
        openValidations: filteredValidations.map((v) => ({ taskId: v.task_id })),
      }),
    ),
  );

  return {
    markdown: enforceLineLimit(mdLines.join("\n"), 35),
    run_root: run,
    thread,
    pid: thread.pid,
    ppid: thread.ppid,
    tier: thread.tier,
    tier_name: thread.tier_name,
    agent_id: activeAgentId ?? thread.agent_id,
    role: thread.role ?? effectiveRole,
    is_main_thread: thread.is_main_thread,
    compliance_state: thread.compliance_state,
    advisory: thread.advisory,
    active_grants: filteredGrants,
    active_leases: filteredLeases,
    active_validations: filteredValidations,
    defect: thread.defect,
    host_profile: thread.host_profile,
    capabilities: thread.capabilities,
    persona_reminder: personaReminder,
    decision_protocols: personaReminder.decisionProtocols,
    checklist: personaReminder.checklist,
  };
}
