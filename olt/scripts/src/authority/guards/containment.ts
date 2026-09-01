import { HarnessError } from "../../core/errors/index.ts";
import { isCoordinatorFileEditForbidden } from "./coordinator-tool-guard.ts";

export interface ContainmentResult {
  readonly action: string;
  readonly strikeLevel: number;
  readonly blocked: boolean;
  readonly message: string;
  readonly revokedTools?: readonly string[] | undefined;
  readonly sanitizedState?: boolean | undefined;
  readonly respawnRequired?: boolean | undefined;
}

export type SupervisoryViolationType =
  | "DIRECT_CODE_EDIT"
  | "DIRECT_TEST_RUN"
  | "DIRECT_MUTATION_COMMAND"
  | "BYPASS_DELEGATION"
  | "CRITIC_JOB_EXECUTION";

export interface ContainmentEngineLike {
  getAgentState(agentId: string): {
    readonly isTerminated?: boolean | undefined;
    readonly strikeCount: number;
    readonly revokedTools?: readonly string[] | undefined;
  };
  interceptAction(params: {
    readonly agentId: string;
    readonly role: string;
    readonly actionType: SupervisoryViolationType;
    readonly attemptedAction: string;
    readonly targetFile?: string | undefined;
    readonly details?: string | undefined;
    readonly timestamp?: string | undefined;
  }): ContainmentResult;
  isToolPermitted(agentId: string, role: string, toolName: string): boolean;
}

export type ContainmentEngine = ContainmentEngineLike;

let defaultEngine: ContainmentEngineLike | null = null;
let defaultEngineFactory: (() => ContainmentEngineLike) | null = null;

export function registerContainmentEngineFactory(factory: () => ContainmentEngineLike): void {
  defaultEngineFactory = factory;
}

export function getDefaultContainmentEngine(): ContainmentEngineLike {
  if (!defaultEngine) {
    if (defaultEngineFactory) {
      defaultEngine = defaultEngineFactory();
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        "No ContainmentEngine has been configured or registered. Call setDefaultContainmentEngine or registerContainmentEngineFactory first.",
      );
    }
  }
  return defaultEngine;
}

export function setDefaultContainmentEngine(engine: ContainmentEngineLike | null): void {
  defaultEngine = engine;
}

export function resetDefaultContainmentEngine(): void {
  defaultEngine = null;
}

const SUPERVISORY_ROLE_NAMES: ReadonlySet<string> = new Set([
  "mind",
  "mind-supervisor",
  "tier-0",
  "mind-auditor",
  "skill-auditor",
  "orchestrator",
  "domain-orchestrator",
  "orch",
  "tier-1",
  "coordinator",
  "feature-coordinator",
  "domain-coordinator",
  "coord",
  "tier-2",
]);

export function isSupervisoryRoleForContainment(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    SUPERVISORY_ROLE_NAMES.has(norm) ||
    norm.startsWith("orchestrator-") ||
    norm.endsWith("-orchestrator") ||
    norm.includes("orchestrator") ||
    norm.startsWith("coordinator-") ||
    norm.endsWith("-coordinator") ||
    norm.includes("coordinator") ||
    norm.includes("supervisor")
  );
}

const TEST_COMMAND_PATTERNS: readonly RegExp[] = [
  /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test(?:\b|$)/i,
  /^(?:bun\s+test|vitest|jest|pytest|cargo\s+test|go\s+test)\b/i,
  /\b(?:test:unit|test:e2e|test:integration|test:coverage)\b/i,
];

const DIRECT_MUTATION_PATTERNS: readonly RegExp[] = [
  /^(?:git\s+(?:commit|push|merge|rebase|cherry-pick|tag))\b/i,
  /^(?:rm|cp|mv|mkdir|touch)\b/i,
  /\b(?:sed\s+-i|awk\s+-i)\b/i,
];

const DELEGATION_BYPASS_COMMANDS: ReadonlySet<string> = new Set([
  "task:claim",
  "task:lease",
  "task:submit",
  "claim_task",
  "lease_task",
]);

const CRITIC_COMMANDS: ReadonlySet<string> = new Set([
  "critic:review",
  "critic:reject",
  "critic:remediate",
  "critic:start",
]);

export interface SupervisoryViolationDetection {
  readonly violationType: SupervisoryViolationType;
  readonly attemptedAction: string;
}

export function detectSupervisoryViolation(params: {
  readonly role: string;
  readonly toolName?: string | undefined;
  readonly command?: string | undefined;
  readonly argv?: readonly string[] | undefined;
  readonly targetFile?: string | undefined;
  readonly actionType?: SupervisoryViolationType | undefined;
}): SupervisoryViolationDetection | null {
  if (!isSupervisoryRoleForContainment(params.role)) {
    return null;
  }

  if (params.actionType) {
    return {
      violationType: params.actionType,
      attemptedAction: params.command ?? params.toolName ?? params.actionType,
    };
  }

  if (params.toolName && isCoordinatorFileEditForbidden(params.toolName)) {
    return {
      violationType: "DIRECT_CODE_EDIT",
      attemptedAction: params.toolName,
    };
  }

  const fullCommand =
    params.command ?? (params.argv && params.argv.length > 0 ? params.argv.join(" ") : undefined);

  if (fullCommand) {
    const trimmed = fullCommand.trim();

    for (const pattern of TEST_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          violationType: "DIRECT_TEST_RUN",
          attemptedAction: trimmed,
        };
      }
    }

    for (const pattern of DIRECT_MUTATION_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          violationType: "DIRECT_MUTATION_COMMAND",
          attemptedAction: trimmed,
        };
      }
    }

    const firstToken = trimmed.split(/\s+/u)[0] ?? "";
    const secondToken = trimmed.split(/\s+/u)[1] ?? "";

    if (DELEGATION_BYPASS_COMMANDS.has(firstToken) || DELEGATION_BYPASS_COMMANDS.has(secondToken)) {
      return {
        violationType: "BYPASS_DELEGATION",
        attemptedAction: trimmed,
      };
    }

    if (CRITIC_COMMANDS.has(firstToken) || CRITIC_COMMANDS.has(secondToken)) {
      return {
        violationType: "CRITIC_JOB_EXECUTION",
        attemptedAction: trimmed,
      };
    }
  }

  if (params.targetFile && params.toolName) {
    const norm = params.toolName.toLowerCase().trim();
    if (
      norm.includes("write") ||
      norm.includes("edit") ||
      norm.includes("replace") ||
      norm.includes("patch")
    ) {
      return {
        violationType: "DIRECT_CODE_EDIT",
        attemptedAction: `${params.toolName} -> ${params.targetFile}`,
      };
    }
  }

  return null;
}

export interface SupervisoryContainmentCheckParams {
  readonly engine?: ContainmentEngineLike | undefined;
  readonly agentId: string;
  readonly role: string;
  readonly toolName?: string | undefined;
  readonly command?: string | undefined;
  readonly argv?: readonly string[] | undefined;
  readonly targetFile?: string | undefined;
  readonly actionType?: SupervisoryViolationType | undefined;
  readonly details?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly throwOnBlock?: boolean | undefined;
}

export function checkSupervisoryContainment(
  params: SupervisoryContainmentCheckParams,
): ContainmentResult {
  const role = params.role;

  if (!isSupervisoryRoleForContainment(role)) {
    return {
      action: "ALLOW",
      strikeLevel: 0,
      blocked: false,
      message: `Role '${role}' is not subject to supervisory containment.`,
    };
  }

  const engine = params.engine ?? getDefaultContainmentEngine();
  const agentId = params.agentId;

  const currentState = engine.getAgentState(agentId);

  if (currentState.isTerminated) {
    const result: ContainmentResult = {
      action: "PERSONA_RESPAWN",
      strikeLevel: 3,
      blocked: true,
      message: `[CONTAINMENT STRIKE 3 - PERSONA_RESPAWN]: Supervisory agent '${agentId}' (${role}) is terminated. All actions blocked. Persona re-spawn and state sanitization required.`,
      revokedTools: currentState.revokedTools,
      sanitizedState: true,
      respawnRequired: true,
    };
    if (params.throwOnBlock) {
      throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", result.message);
    }
    return result;
  }

  const detected = detectSupervisoryViolation({
    role,
    toolName: params.toolName,
    command: params.command,
    argv: params.argv,
    targetFile: params.targetFile,
    actionType: params.actionType,
  });

  if (detected) {
    const result = engine.interceptAction({
      agentId,
      role,
      actionType: detected.violationType,
      attemptedAction: detected.attemptedAction,
      targetFile: params.targetFile,
      details: params.details,
      timestamp: params.timestamp,
    });

    if (params.throwOnBlock && result.blocked) {
      const code =
        result.strikeLevel === 3 ? "ROLE_CONFINEMENT_VIOLATION" : "ROLE_BOUNDARY_DEVIATION";
      throw new HarnessError(code, result.message);
    }

    return result;
  }

  if (params.toolName && !engine.isToolPermitted(agentId, role, params.toolName)) {
    const result: ContainmentResult = {
      action: "CAPABILITY_REVOCATION",
      strikeLevel: currentState.strikeCount,
      blocked: true,
      message: `[CONTAINMENT HARD REVOCATION]: Supervisory agent '${agentId}' (${role}) is locked from tool '${params.toolName}'. Capabilities have been revoked. Use delegation and communication tools ('invoke_subagent', 'msg:send', 'dag', 'doctor').`,
      revokedTools: currentState.revokedTools,
    };
    if (params.throwOnBlock) {
      throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", result.message);
    }
    return result;
  }

  return {
    action: "ALLOW",
    strikeLevel: currentState.strikeCount,
    blocked: false,
    message: `Action permitted for supervisory agent '${agentId}' (${role}).`,
  };
}

export function assertSupervisoryContainment(
  params: SupervisoryContainmentCheckParams,
): ContainmentResult {
  return checkSupervisoryContainment({ ...params, throwOnBlock: true });
}
