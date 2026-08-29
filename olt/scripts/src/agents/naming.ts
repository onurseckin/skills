import { AGENT_NAMING_STANDARDS } from "./naming-types.ts";
import type {
  ExecutionTier,
  AgentBindingType,
  StandardAgentRole,
  AgentNamingStandardDefinition,
} from "./naming-types.ts";
import { agentIdToRole, agentIdToTier, roleToTier } from "./naming-utils.ts";

export {
  AGENT_NAMING_STANDARDS,
  type ExecutionTier,
  type AgentBindingType,
  type StandardAgentRole,
  type AgentNamingStandardDefinition,
} from "./naming-types.ts";

export {
  roleToTier,
  agentIdToTier,
  agentIdToRole,
} from "./naming-utils.ts";

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
