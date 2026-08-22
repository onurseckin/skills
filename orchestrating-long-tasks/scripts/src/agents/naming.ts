export type ExecutionTier = 0 | 1 | 2 | 3;

export type StandardAgentRole =
  | "mind"
  | "orchestrator"
  | "mind-auditor"
  | "coordinator"
  | "implementer"
  | "validator"
  | "repairer"
  | "completeness-critic"
  | "critic"
  | "planner"
  | "plan-validator"
  | "validator-code-quality"
  | "validator-ui-design"
  | "validator-security"
  | "validator-product"
  | "validator-system-design"
  | "sub-implementer"
  | "sub-validator"
  | "sub-investigator";

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
    regexPattern: /^sub-investigator_(subtask-[a-z0-9]+|[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "sub-investigator_subtask-1-diag",
    description: "Tier 3 Branch Sub-Investigator bound to branch subtask ID",
  },
};

export function roleToTier(role: string): ExecutionTier {
  const normalized = role.toLowerCase().trim();
  if (
    normalized === "mind" ||
    normalized === "human" ||
    normalized === "user" ||
    normalized === "lead"
  ) {
    return 0;
  }
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
  if (/^(impl|val|critic|completeness[-_]critic|repair|worker|sub|plan)/i.test(normalized)) return 3;
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
