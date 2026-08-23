import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import os from "node:os";
import { resolveDefectsPath } from "../shared/paths.ts";

export type ExecutionTier = 0 | 1 | 2 | 3;

export const TIER_NAMES: Readonly<Record<ExecutionTier, string>> = {
  0: "Tier 0: Mind Lead (Observe-Only Supervisor & Human Shell)",
  1: "Tier 1: Orchestrator Lead (Plan Supervisor & Release Manager)",
  2: "Tier 2: Coordinator Lead (Wave Execution & Lease Manager)",
  3: "Tier 3: Implementer / Validator / Repairer / Completeness Critic",
};

export const MAIN_THREAD_ADVISORY =
  "[MAIN THREAD RESTRAINT ACTIVE]: Main interactive thread must not directly modify files or execute implementation tasks. It must dispatch Tier 2 Background Coordinators or Tier 3 Implementers via invoke_subagent.";

export interface DefectRecord {
  id: string;
  type:
    | "main_thread_direct_execution"
    | "main_thread_boundary_violation"
    | "role_escalation"
    | "unauthorized_mutation"
    | "role_confinement_violation"
    | "cross_tier_spawn_violation";
  severity: "critical" | "warning";
  timestamp: string;
  pid: number;
  ppid: number;
  agent_id: string | null;
  observation: string;
  remediation: string;
  context: {
    cwd: string;
    indicators: Record<string, string>;
  };
}

export interface HostProfile {
  app_id: string;
  os_platform: string;
  os_release: string;
  os_arch: string;
  runtime_node: string | null;
  runtime_bun: string | null;
}

export interface CapabilitiesProfile {
  tools: readonly string[];
  environment_grants: readonly string[];
  command_taxonomy: string;
}

export interface ThreadIdentification {
  pid: number;
  ppid: number;
  tier: ExecutionTier;
  tier_name: string;
  role: string | null;
  agent_id: string | null;
  is_main_thread: boolean;
  compliance_state: "compliant" | "restrained" | "violation";
  advisory: string | null;
  indicators: Record<string, string>;
  defect: DefectRecord | null;
  host_profile: HostProfile;
  capabilities: CapabilitiesProfile;
}

export interface ExecutionContextOptions {
  pid?: number | undefined;
  ppid?: number | undefined;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined;
  cwd?: string | undefined;
  runRoot?: string | undefined;
  agentId?: string | undefined;
  role?: string | undefined;
  tier?: ExecutionTier | undefined;
  isInteractiveMainThread?: boolean | undefined;
}

export function parseTierValue(value: string | undefined): ExecutionTier | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "0" ||
    normalized === "tier-0" ||
    normalized === "tier_0" ||
    normalized === "tier 0" ||
    normalized === "human" ||
    normalized === "mind" ||
    normalized.startsWith("tier 0") ||
    normalized.startsWith("tier 0:")
  ) {
    return 0;
  }
  if (
    normalized === "1" ||
    normalized === "tier-1" ||
    normalized === "tier_1" ||
    normalized === "tier 1" ||
    normalized === "orchestrator" ||
    normalized === "orch" ||
    normalized === "mind-auditor" ||
    normalized === "auditor" ||
    normalized.startsWith("tier 1") ||
    normalized.startsWith("tier 1:")
  ) {
    return 1;
  }
  if (
    normalized === "2" ||
    normalized === "tier-2" ||
    normalized === "tier_2" ||
    normalized === "tier 2" ||
    normalized === "coordinator" ||
    normalized === "coord" ||
    normalized.startsWith("tier 2") ||
    normalized.startsWith("tier 2:")
  ) {
    return 2;
  }
  if (
    normalized === "3" ||
    normalized === "tier-3" ||
    normalized === "tier_3" ||
    normalized === "tier 3" ||
    normalized === "implementer" ||
    normalized === "validator" ||
    normalized === "critic" ||
    normalized === "completeness-critic" ||
    normalized === "repairer" ||
    normalized === "planner" ||
    normalized === "plan-validator" ||
    normalized.startsWith("tier 3") ||
    normalized.startsWith("tier 3:")
  ) {
    return 3;
  }
  return null;
}

export function roleToTier(role: string): ExecutionTier {
  const normalized = role.toLowerCase().trim();
  if (
    normalized === "mind" ||
    normalized === "human" ||
    normalized === "user" ||
    normalized === "lead"
  )
    return 0;
  if (
    normalized === "orchestrator" ||
    normalized.startsWith("orch-") ||
    normalized.startsWith("orchestrator-") ||
    normalized === "orch" ||
    normalized === "mind-auditor" ||
    normalized === "auditor"
  ) {
    return 1;
  }
  if (
    normalized === "coordinator" ||
    normalized.startsWith("coord-") ||
    normalized.startsWith("coordinator-") ||
    normalized === "coord"
  ) {
    return 2;
  }
  return 3;
}

export function agentIdToTier(agentId: string): ExecutionTier | null {
  const normalized = agentId.toLowerCase().trim();
  if (/^mind[-_]audit|^audit/i.test(normalized)) return 1;
  if (/^mind|^human/i.test(normalized)) return 0;
  if (/^orch/i.test(normalized)) return 1;
  if (/^coord/i.test(normalized)) return 2;
  if (/^(impl|val|critic|completeness[-_]critic|repair|worker|sub|plan)/i.test(normalized))
    return 3;
  return null;
}

export function agentIdToRole(agentId: string): string | null {
  const normalized = agentId.toLowerCase().trim();
  if (/^mind[-_]audit|^audit/i.test(normalized)) return "mind-auditor";
  if (/^mind/i.test(normalized)) return "mind";
  if (/^human/i.test(normalized)) return "human";
  if (/^orch/i.test(normalized)) return "orchestrator";
  if (/^coord/i.test(normalized)) return "coordinator";
  if (/^validator[-_]code[-_]quality/i.test(normalized)) return "validator-code-quality";
  if (/^validator[-_]ui[-_]design/i.test(normalized)) return "validator-ui-design";
  if (/^validator[-_]security/i.test(normalized)) return "validator-security";
  if (/^validator[-_]product/i.test(normalized)) return "validator-product";
  if (/^validator[-_]system[-_]design/i.test(normalized)) return "validator-system-design";
  if (/^sub[-_]implementer/i.test(normalized)) return "sub-implementer";
  if (/^sub[-_]validator/i.test(normalized)) return "sub-validator";
  if (/^sub[-_]investigator/i.test(normalized)) return "sub-investigator";
  if (/^impl/i.test(normalized)) return "implementer";
  if (/^val/i.test(normalized)) return "validator";
  if (/^(completeness[-_]critic|critic)/i.test(normalized)) return "completeness-critic";
  if (/^repair/i.test(normalized)) return "repairer";
  if (/^plan[-_]val/i.test(normalized)) return "plan-validator";
  if (/^plan/i.test(normalized)) return "planner";
  return null;
}

export function recordDefect(
  defect: DefectRecord,
  options: { runRoot?: string | undefined; cwd?: string | undefined } = {},
): DefectRecord {
  const targetFile = options.runRoot
    ? join(options.runRoot, "defects.jsonl")
    : resolveDefectsPath(options.cwd);

  try {
    const dir = dirname(targetFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(targetFile, `${JSON.stringify(defect)}\n`, "utf8");
  } catch {
    // Disk recording is best-effort and non-fatal
  }
  return defect;
}

export function detectHostApp(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const termProgram = env["TERM_PROGRAM"]?.toLowerCase() || "";

  if (env["CLAUDE_CODE_VERSION"] || env["CLAUDE_CLI"]) return "Claude Code";
  if (env["ANTIGRAVITY_CLI"] || env["GEMINI_CLI"] || env["ANTIGRAVITY_VERSION"])
    return "Antigravity/Gemini CLI";
  if (termProgram === "cursor" || env["CURSOR_VERSION"]) return "Cursor";
  if (env["OPENCODE_VERSION"] || env["OPENCODE_CLI"] || env["OPENCODE"]) return "OpenCode";
  if (env["CODEX_VERSION"] || env["CODEX_CLI"] || env["CODEX"]) return "Codex";
  if (termProgram === "vscode") return "VSCode Terminal";

  return "Generic Host";
}

export function buildCapabilitiesProfile(
  tier: ExecutionTier,
  env: Record<string, string | undefined>,
): CapabilitiesProfile {
  let taxonomy = "Restricted Sandbox";
  if (tier === 0) taxonomy = "Full Root / All Permissions";
  else if (tier === 1) taxonomy = "Orchestration / Delegation Only";
  else if (tier === 2) taxonomy = "Coordination / Dispatch Only";
  else if (tier === 3) taxonomy = "Implementation / Execution";

  const rawTools = env.GRANTED_TOOLS || env.AVAILABLE_TOOLS || "";
  const tools = rawTools
    ? rawTools
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const rawGrants = env.ENVIRONMENT_GRANTS || env.TOOL_GRANTS || "";
  const environment_grants = rawGrants
    ? rawGrants
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
    : [];

  return {
    tools,
    environment_grants,
    command_taxonomy: taxonomy,
  };
}

export function identifyExecutionContext(
  options: ExecutionContextOptions = {},
): ThreadIdentification {
  const pid = options.pid ?? (typeof process !== "undefined" ? process.pid : 0);
  const ppid = options.ppid ?? (typeof process !== "undefined" ? process.ppid : 0);
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const cwd = options.cwd ?? (typeof process !== "undefined" ? process.cwd() : ".");

  const indicators: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      (key.startsWith("HARNESS_") ||
        key.startsWith("AGENT_") ||
        key.startsWith("HOST_") ||
        key === "ROLE" ||
        key === "SESSION_ID" ||
        key === "CONVERSATION_ID" ||
        key === "SUBAGENT_CONVERSATION_ID" ||
        key === "INTERACTIVE_MAIN_THREAD")
    ) {
      indicators[key] = value;
    }
  }

  const explicitTierEnv = parseTierValue(env.HARNESS_EXECUTION_TIER);
  const explicitRole = options.role ?? env.HARNESS_AGENT_ROLE ?? env.AGENT_ROLE ?? env.ROLE ?? null;
  const explicitAgentId = options.agentId ?? env.HARNESS_AGENT_ID ?? env.AGENT_ID ?? null;

  const isSubagent =
    env.HOST_SUBAGENT === "1" ||
    env.HOST_SUBAGENT === "true" ||
    Boolean(env.SUBAGENT_CONVERSATION_ID) ||
    Boolean(env.SUBAGENT_ROLE) ||
    (explicitRole !== null && explicitRole !== "user" && explicitRole !== "main");

  const hasInteractiveMainIndicator =
    options.isInteractiveMainThread === true ||
    (options.isInteractiveMainThread !== false &&
      (env.INTERACTIVE_MAIN_THREAD === "1" ||
        env.INTERACTIVE_MAIN_THREAD === "true" ||
        ((Boolean(env.HOST_SESSION) || Boolean(env.CONVERSATION_ID) || Boolean(env.SESSION_ID)) &&
          !isSubagent &&
          explicitTierEnv === null &&
          explicitRole === null &&
          explicitAgentId === null)));

  let tier: ExecutionTier = 0;
  let inferredRole: string | null = explicitRole;
  let inferredAgentId: string | null = explicitAgentId;

  if (options.tier !== undefined) {
    tier = options.tier;
    if (inferredRole === null) {
      if (tier === 0) inferredRole = "mind";
      else if (tier === 1) inferredRole = "orchestrator";
      else if (tier === 2) inferredRole = "coordinator";
      else if (tier === 3) inferredRole = "implementer";
    }
  } else if (explicitTierEnv !== null) {
    tier = explicitTierEnv;
    if (inferredRole === null) {
      if (tier === 0) inferredRole = "mind";
      else if (tier === 1) inferredRole = "orchestrator";
      else if (tier === 2) inferredRole = "coordinator";
      else if (tier === 3) inferredRole = "implementer";
    }
  } else if (explicitRole !== null) {
    tier = roleToTier(explicitRole);
  } else if (explicitAgentId !== null) {
    const tierFromAgent = agentIdToTier(explicitAgentId);
    tier = tierFromAgent ?? 3;
    if (inferredRole === null) {
      inferredRole = agentIdToRole(explicitAgentId);
    }
  } else if (hasInteractiveMainIndicator) {
    tier = 0;
  } else {
    tier = 0;
  }

  const isMainThread = hasInteractiveMainIndicator;
  const complianceState: "compliant" | "restrained" | "violation" = isMainThread
    ? "restrained"
    : "compliant";

  const advisory = isMainThread ? MAIN_THREAD_ADVISORY : null;

  let defect: DefectRecord | null = null;
  if (isMainThread) {
    const defectId = `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    defect = {
      id: defectId,
      type: "main_thread_direct_execution",
      severity: "critical",
      timestamp: new Date().toISOString(),
      pid,
      ppid,
      agent_id: inferredAgentId,
      observation:
        "Execution detected on interactive main conversation thread without subagent boundary delegation.",
      remediation:
        "Main thread must not directly modify code or execute implementation tasks. Dispatch Tier 2 Background Coordinators or Tier 3 Implementers via invoke_subagent.",
      context: {
        cwd,
        indicators,
      },
    };
    recordDefect(defect, {
      ...(options.runRoot !== undefined ? { runRoot: options.runRoot } : {}),
      cwd,
    });
  }

  const host_profile: HostProfile = {
    app_id: detectHostApp(env),
    os_platform: os.platform(),
    os_release: os.release(),
    os_arch: os.arch(),
    runtime_node: process.versions?.node ?? null,
    runtime_bun: (process.versions as Record<string, string | undefined>)?.bun ?? null,
  };

  const capabilities = buildCapabilitiesProfile(tier, env);

  return {
    pid,
    ppid,
    tier,
    tier_name: isMainThread ? "Main Interactive Agent Thread" : TIER_NAMES[tier],
    role: inferredRole,
    agent_id: inferredAgentId,
    is_main_thread: isMainThread,
    compliance_state: complianceState,
    advisory,
    indicators,
    defect,
    host_profile,
    capabilities,
  };
}

export function formatThreadIdentificationBrief(id: ThreadIdentification): string {
  const lines = [
    `### Thread Authority Identification (\`whoami\`)`,
    `- **PID / PPID**: \`${id.pid}\` / \`${id.ppid}\``,
    `- **Execution Tier**: \`${id.is_main_thread ? "Main Interactive Agent Thread" : `Tier ${id.tier}`}\` (${id.tier_name})`,
    `- **Active Agent**: \`${id.agent_id ?? "none"}\`${id.role ? ` (role: \`${id.role}\`)` : ""}`,
    `- **Compliance**: \`${id.compliance_state.toUpperCase()}\``,
    `- **Host App**: \`${id.host_profile.app_id}\``,
    `- **OS Platform**: \`${id.host_profile.os_platform} ${id.host_profile.os_release} (${id.host_profile.os_arch})\``,
    `- **Runtime**: \`${id.host_profile.runtime_bun ? `bun ${id.host_profile.runtime_bun}` : `node ${id.host_profile.runtime_node}`}\``,
    `- **Taxonomy**: \`${id.capabilities.command_taxonomy}\``,
  ];

  if (id.capabilities.tools.length > 0) {
    lines.push(`- **Tools**: ${id.capabilities.tools.join(", ")}`);
  }
  if (id.capabilities.environment_grants.length > 0) {
    lines.push(`- **Environment Grants**: ${id.capabilities.environment_grants.join(", ")}`);
  }

  if (id.advisory) {
    lines.push(`- **Advisory**: ⚠️ ${id.advisory}`);
  }
  if (id.defect) {
    lines.push(`- **Defect Logged**: \`${id.defect.id}\` (${id.defect.type})`);
  }

  return lines.join("\n");
}

export interface TierSpawningValidationResult {
  readonly allowed: boolean;
  readonly parentTier: ExecutionTier;
  readonly childTier: ExecutionTier;
  readonly parentRole: string | null;
  readonly childRole: string | null;
  readonly reason: string | null;
}

export function validateTierSpawning(
  parentTier: ExecutionTier,
  childTier: ExecutionTier,
  parentRole?: string | null,
  childRole?: string | null,
): TierSpawningValidationResult {
  const pRole =
    parentRole ??
    (parentTier === 0
      ? "mind"
      : parentTier === 1
        ? "orchestrator"
        : parentTier === 2
          ? "coordinator"
          : "implementer");
  const cRole =
    childRole ??
    (childTier === 1 ? "orchestrator" : childTier === 2 ? "coordinator" : "implementer");

  // Tier 0 (Mind) can deploy Tier 1 (Orchestrator, Mind Auditor)
  if (parentTier === 0) {
    if (childTier === 1) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 0 Mind Lead cannot directly spawn Tier ${childTier} (${cRole}). Mind may only deploy Tier 1 Orchestrators.`,
    };
  }

  // Tier 1 (Orchestrator) can deploy Tier 2 (Coordinator)
  if (parentTier === 1) {
    if (childTier === 2) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 1 Orchestrator Lead cannot directly spawn Tier ${childTier} (${cRole}). Orchestrators must deploy Tier 2 Coordinators to manage wave execution.`,
    };
  }

  // Tier 2 (Coordinator) can deploy Tier 3 (Implementers, Validators, Critics, Repairers, Planners)
  if (parentTier === 2) {
    if (childTier === 3) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 2 Coordinator Lead cannot deploy Tier ${childTier} (${cRole}). Coordinators deploy Tier 3 Implementers, Validators, Repairers, and Critics.`,
    };
  }

  // Tier 3 (Implementers/Validators) can only spawn Tier 3 sub-agents (sub-implementer, sub-validator, sub-investigator)
  if (parentTier === 3) {
    if (childTier === 3) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 3 worker cannot spawn Tier ${childTier} (${cRole}) (role escalation violation).`,
    };
  }

  return {
    allowed: false,
    parentTier,
    childTier,
    parentRole: pRole,
    childRole: cRole,
    reason: `Invalid tier hierarchy transition from Tier ${parentTier} to Tier ${childTier}.`,
  };
}

// ---------------------------------------------------------------------------
// Standardized Agent Naming Conventions & Utilities
// ---------------------------------------------------------------------------

export type AgentBindingType = "pulse" | "phase" | "domain" | "task" | "subtask" | "audit";

export interface AgentNamingStandardDefinition {
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly bindingType: AgentBindingType;
  readonly formatTemplate: string;
  readonly regexPattern: RegExp;
  readonly example: string;
  readonly description: string;
}

export const AGENT_NAMING_STANDARDS: Readonly<Record<string, AgentNamingStandardDefinition>> = {
  mind: {
    role: "mind",
    tier: 0,
    bindingType: "pulse",
    formatTemplate: "mind_<pulse-slug>",
    regexPattern: /^mind_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "mind_pulse-gen-1",
    description: "Tier 0 Mind consciousness bound to active pulse cycle",
  },
  orchestrator: {
    role: "orchestrator",
    tier: 1,
    bindingType: "phase",
    formatTemplate: "orchestrator_<run-or-phase-slug>",
    regexPattern: /^orchestrator_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "orchestrator_wave-2-foundations",
    description: "Tier 1 Meta-Orchestrator bound to run or execution phase",
  },
  "mind-auditor": {
    role: "mind-auditor",
    tier: 1,
    bindingType: "audit",
    formatTemplate: "mind-auditor_<audit-window-slug>",
    regexPattern: /^mind-auditor_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "mind-auditor_audit-gen-1",
    description: "Tier 1 Independent Mind Auditor bound to audit window",
  },
  coordinator: {
    role: "coordinator",
    tier: 2,
    bindingType: "domain",
    formatTemplate: "coordinator_<domain-slug>",
    regexPattern: /^coordinator_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "coordinator_domain-cli-tools",
    description: "Tier 2 Domain Coordinator bound to domain or wave scope",
  },
  implementer: {
    role: "implementer",
    tier: 3,
    bindingType: "task",
    formatTemplate: "implementer_<task-id>[-<descriptive-slug>]",
    regexPattern: /^implementer_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "implementer_task-p47-autonomic-watchdog",
    description: "Tier 3 Task Implementer strictly bound to leased task ID",
  },
  validator: {
    role: "validator",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator_task-p47-autonomic-watchdog",
    description: "Tier 3 Adversarial Validator strictly bound to validated task ID",
  },
  repairer: {
    role: "repairer",
    tier: 3,
    bindingType: "task",
    formatTemplate: "repairer_<task-id>[-<descriptive-slug>]",
    regexPattern: /^repairer_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "repairer_task-p47-autonomic-watchdog",
    description: "Tier 3 Task Repairer bound to leased task ID for remediation",
  },
  "completeness-critic": {
    role: "completeness-critic",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "completeness-critic_<run-or-wave-slug>",
    regexPattern: /^completeness-critic_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "completeness-critic_wave-2-foundations",
    description: "Tier 3 Completeness Critic bound to whole run or wave review",
  },
  critic: {
    role: "critic",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "completeness-critic_<run-or-wave-slug>",
    regexPattern: /^completeness-critic_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "completeness-critic_wave-2-foundations",
    description: "Tier 3 Completeness Critic bound to whole run or wave review",
  },
  planner: {
    role: "planner",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "planner_<phase-or-run-slug>",
    regexPattern: /^planner_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "planner_phase-1-planning",
    description: "Tier 3 Task Planner bound to planning phase or run",
  },
  "plan-validator": {
    role: "plan-validator",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "plan-validator_<phase-or-run-slug>",
    regexPattern: /^plan-validator_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "plan-validator_phase-1-planning",
    description: "Tier 3 Plan Validator bound to plan review phase or run",
  },
  "validator-code-quality": {
    role: "validator-code-quality",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-code-quality_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-code-quality_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-code-quality_task-p54-agent-naming",
    description: "Tier 3 Code Quality Specialist Validator bound to task ID",
  },
  "validator-ui-design": {
    role: "validator-ui-design",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-ui-design_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-ui-design_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-ui-design_task-p48-viewport-matrix",
    description: "Tier 3 UI/Visual Design Specialist Validator bound to task ID",
  },
  "validator-security": {
    role: "validator-security",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-security_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-security_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-security_task-p49-auth-guard",
    description: "Tier 3 Security Specialist Validator bound to task ID",
  },
  "validator-product": {
    role: "validator-product",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-product_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-product_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-product_task-p50-flow-coherence",
    description: "Tier 3 Product Value Specialist Validator bound to task ID",
  },
  "validator-system-design": {
    role: "validator-system-design",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-system-design_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-system-design_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-system-design_task-p51-schema-migration",
    description: "Tier 3 System Design Specialist Validator bound to task ID",
  },
  "sub-implementer": {
    role: "sub-implementer",
    tier: 3,
    bindingType: "subtask",
    formatTemplate: "sub-implementer_<subtask-id>[-<descriptive-slug>]",
    regexPattern: /^sub-implementer_(subtask-[a-z0-9]+|[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "sub-implementer_subtask-1-auth",
    description: "Tier 3 Branch Sub-Implementer bound to branch subtask ID",
  },
  "sub-validator": {
    role: "sub-validator",
    tier: 3,
    bindingType: "subtask",
    formatTemplate: "sub-validator_<subtask-id>[-<descriptive-slug>]",
    regexPattern: /^sub-validator_(subtask-[a-z0-9]+|[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "sub-validator_subtask-1-proof",
    description: "Tier 3 Branch Sub-Validator bound to branch subtask ID",
  },
  "sub-investigator": {
    role: "sub-investigator",
    tier: 3,
    bindingType: "subtask",
    formatTemplate: "sub-investigator_<subtask-id>[-<descriptive-slug>]",
    regexPattern:
      /^sub-investigator_(subtask-[a-z0-9]+|[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "sub-investigator_subtask-1-diag",
    description: "Tier 3 Branch Sub-Investigator bound to branch subtask ID",
  },
};

export interface StandardAgentIdParsedComponents {
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly bindingType: AgentBindingType;
  readonly contextOrTaskId: string;
  readonly taskId?: string | undefined;
  readonly taskSlug?: string | undefined;
}

export function parseStandardAgentId(agentId: string): StandardAgentIdParsedComponents | null {
  const trimmed = agentId.trim();
  const underscoreIndex = trimmed.indexOf("_");
  if (underscoreIndex <= 0) return null;

  const prefix = trimmed.slice(0, underscoreIndex);
  const suffix = trimmed.slice(underscoreIndex + 1);
  if (!suffix) return null;

  const std = AGENT_NAMING_STANDARDS[prefix];
  if (!std) return null;

  if (!std.regexPattern.test(trimmed)) return null;

  const components: {
    role: string;
    tier: ExecutionTier;
    bindingType: AgentBindingType;
    contextOrTaskId: string;
    taskId?: string | undefined;
    taskSlug?: string | undefined;
  } = {
    role: std.role,
    tier: std.tier,
    bindingType: std.bindingType,
    contextOrTaskId: suffix,
  };

  if (std.bindingType === "task" || std.bindingType === "subtask") {
    const match = trimmed.match(std.regexPattern);
    if (match && match[1]) {
      components.taskId = match[1];
      if (match[2]) {
        components.taskSlug = match[2];
      }
    }
  }

  return components;
}

export function isStandardAgentId(agentId: string): boolean {
  return parseStandardAgentId(agentId) !== null;
}

export function recommendStandardAgentId(
  role: string,
  contextOrTaskId: string,
  taskSlug?: string,
): string {
  const normRole = role.toLowerCase().trim();
  const cleanContext = contextOrTaskId.toLowerCase().trim();
  const cleanSlug = taskSlug?.toLowerCase().trim();

  const std = AGENT_NAMING_STANDARDS[normRole];
  const prefix = std ? std.role : normRole;

  if (cleanSlug) {
    return `${prefix}_${cleanContext}-${cleanSlug}`;
  }
  return `${prefix}_${cleanContext}`;
}

export interface AgentNamingValidationResult {
  readonly valid: boolean;
  readonly agentId: string;
  readonly role: string | null;
  readonly tier: ExecutionTier | null;
  readonly parsedComponents: StandardAgentIdParsedComponents | null;
  readonly reason: string | null;
  readonly recommendedAgentId: string | null;
}

export function validateAgentNamingConvention(
  agentId: string,
  expectedRole?: string,
  expectedTier?: number,
  expectedTaskId?: string,
): AgentNamingValidationResult {
  const trimmed = agentId.trim();
  const parsed = parseStandardAgentId(trimmed);

  if (!parsed) {
    let inferredRole = "implementer";
    if (typeof expectedRole === "string" && expectedRole.length > 0) {
      inferredRole = expectedRole;
    } else {
      const byId = agentIdToRole(trimmed);
      if (typeof byId === "string" && byId.length > 0) {
        inferredRole = byId;
      }
    }
    let inferredContext = "task-id";
    if (typeof expectedTaskId === "string" && expectedTaskId.length > 0) {
      inferredContext = expectedTaskId;
    }
    const recommendation = recommendStandardAgentId(inferredRole, inferredContext);
    return {
      valid: false,
      agentId: trimmed,
      role: agentIdToRole(trimmed),
      tier: agentIdToTier(trimmed),
      parsedComponents: null,
      reason: `Agent ID '${trimmed}' does not match the standardized naming convention. Standard template for role '${inferredRole}' is '<role>_<context-or-task-id>'.`,
      recommendedAgentId: recommendation,
    };
  }

  if (expectedRole && parsed.role !== expectedRole.toLowerCase().trim()) {
    const recommendation = recommendStandardAgentId(
      expectedRole,
      expectedTaskId ?? parsed.contextOrTaskId,
    );
    return {
      valid: false,
      agentId: trimmed,
      role: parsed.role,
      tier: parsed.tier,
      parsedComponents: parsed,
      reason: `Role mismatch: Agent ID prefix indicates role '${parsed.role}', but expected '${expectedRole}'.`,
      recommendedAgentId: recommendation,
    };
  }

  if (expectedTier !== undefined && parsed.tier !== expectedTier) {
    return {
      valid: false,
      agentId: trimmed,
      role: parsed.role,
      tier: parsed.tier,
      parsedComponents: parsed,
      reason: `Tier mismatch: Agent '${trimmed}' belongs to Tier ${parsed.tier}, but expected Tier ${expectedTier}.`,
      recommendedAgentId: null,
    };
  }

  if (expectedTaskId && parsed.taskId && parsed.taskId !== expectedTaskId) {
    const recommendation = recommendStandardAgentId(parsed.role, expectedTaskId, parsed.taskSlug);
    return {
      valid: false,
      agentId: trimmed,
      role: parsed.role,
      tier: parsed.tier,
      parsedComponents: parsed,
      reason: `Task ID mismatch: Agent '${trimmed}' is bound to task '${parsed.taskId}', but assigned task is '${expectedTaskId}'.`,
      recommendedAgentId: recommendation,
    };
  }

  return {
    valid: true,
    agentId: trimmed,
    role: parsed.role,
    tier: parsed.tier,
    parsedComponents: parsed,
    reason: null,
    recommendedAgentId: null,
  };
}
