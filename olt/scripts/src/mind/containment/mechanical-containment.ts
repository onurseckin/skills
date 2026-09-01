import type {
  AgentContainmentState,
  ContainmentActionType,
  ContainmentEngineOptions,
  ContainmentResult,
  ContainmentStrike,
  InterceptActionParams,
  SerializedContainmentEngine,
  SupervisoryViolation,
} from "./types.ts";

export const DEFAULT_REVOKED_TOOLS: readonly string[] = [
  "write_to_file",
  "replace_file_content",
  "run_command",
  "edit_file",
  "notebook_edit",
  "generate_image",
] as const;

export const ALLOWED_SUPERVISORY_TOOLS: readonly string[] = [
  "invoke_subagent",
  "msg:send",
  "dag",
  "doctor",
  "send_message",
  "view_file",
  "list_dir",
  "grep_search",
  "find_by_name",
  "read_url_content",
  "search_web",
  "schedule",
  "manage_task",
  "read_resource",
  "list_resources",
] as const;

function normalizeToolName(toolName: string): string {
  return toolName
    .toLowerCase()
    .trim()
    .replace(/^mcp_[^_]+_/, "");
}

export class MechanicalContainmentEngine {
  private readonly agentStates: Map<string, AgentContainmentState> = new Map();
  private readonly options: ContainmentEngineOptions;
  private readonly revokedToolsList: readonly string[];
  private readonly allowedSupervisoryToolsSet: ReadonlySet<string>;

  constructor(options: ContainmentEngineOptions = {}) {
    this.options = options;
    this.revokedToolsList = options.customRevokedTools ?? DEFAULT_REVOKED_TOOLS;
    this.allowedSupervisoryToolsSet = new Set(ALLOWED_SUPERVISORY_TOOLS.map(normalizeToolName));
  }

  public interceptAction(params: InterceptActionParams): ContainmentResult {
    const existing = this.getAgentState(params.agentId);

    if (existing.isTerminated) {
      const result: ContainmentResult = {
        action: "PERSONA_RESPAWN",
        strikeLevel: 3,
        blocked: true,
        message: `[CONTAINMENT STRIKE 3 - PERSONA_RESPAWN]: Supervisory agent '${params.agentId}' (${params.role}) is terminated. All actions blocked. Clean persona re-spawn and state sanitization required.`,
        revokedTools: existing.revokedTools,
        sanitizedState: true,
        respawnRequired: true,
      };
      if (this.options.onViolation && existing.violations.length > 0) {
        const lastViol = existing.violations[existing.violations.length - 1];
        if (lastViol) {
          this.options.onViolation(lastViol, result);
        }
      }
      return result;
    }

    const nextStrike = Math.min(3, existing.strikeCount + 1) as ContainmentStrike;
    const timestamp = params.timestamp ?? new Date().toISOString();

    const violation: SupervisoryViolation = {
      violationId: `viol-containment-${params.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: params.agentId,
      role: params.role,
      violationType: params.actionType,
      attemptedAction: params.attemptedAction,
      ...(params.targetFile !== undefined ? { targetFile: params.targetFile } : {}),
      timestamp,
      ...(params.details !== undefined ? { details: params.details } : {}),
    };

    let action: ContainmentActionType;
    let message: string;
    let revokedTools: readonly string[] | undefined;
    let sanitizedState: boolean | undefined;
    let respawnRequired: boolean | undefined;

    const fileContext = params.targetFile ? ` on '${params.targetFile}'` : "";

    switch (nextStrike) {
      case 1: {
        action = "HALT_AND_DELEGATE";
        message = `[CONTAINMENT STRIKE 1 - HALT_AND_DELEGATE]: Supervisory role '${params.role}' (agent '${params.agentId}') attempted unauthorized direct action: ${params.actionType} (${params.attemptedAction})${fileContext}. Direct execution and file modifications are strictly forbidden for supervisory tiers. Action blocked. Decompose the task into discrete work units and dispatch a Tier 3 Implementer via invoke_subagent.`;
        sanitizedState = false;
        respawnRequired = false;
        break;
      }
      case 2: {
        action = "CAPABILITY_REVOCATION";
        message = `[CONTAINMENT STRIKE 2 - CAPABILITY_REVOCATION]: Supervisory role '${params.role}' (agent '${params.agentId}') repeated boundary violation: ${params.actionType} (${params.attemptedAction})${fileContext}. Hard capability revocation activated: write and test execution tools ('write_to_file', 'replace_file_content', 'run_command') are mechanically stripped. Agent is locked strictly to delegation and communication tools ('invoke_subagent', 'msg:send', 'dag', 'doctor').`;
        revokedTools = this.revokedToolsList;
        sanitizedState = false;
        respawnRequired = false;
        break;
      }
      case 3:
      default: {
        action = "PERSONA_RESPAWN";
        message = `[CONTAINMENT STRIKE 3 - PERSONA_RESPAWN]: Supervisory role '${params.role}' (agent '${params.agentId}') reached Strike 3 with violation: ${params.actionType} (${params.attemptedAction})${fileContext}. Supervisory persona is irrecoverably compromised. Agent terminated, rogue state sanitized, clean supervisory persona re-anchor required.`;
        revokedTools = this.revokedToolsList;
        sanitizedState = true;
        respawnRequired = true;
        break;
      }
    }

    const updatedState: AgentContainmentState = {
      agentId: params.agentId,
      role: params.role,
      strikeCount: nextStrike,
      violations: [...existing.violations, violation],
      capabilitiesRevoked: nextStrike >= 2,
      revokedTools: nextStrike >= 2 ? this.revokedToolsList : [],
      isTerminated: nextStrike >= 3,
      lastViolationAt: timestamp,
    };

    this.agentStates.set(params.agentId, updatedState);

    const result: ContainmentResult = {
      action,
      strikeLevel: nextStrike,
      blocked: true,
      message,
      violation,
      ...(revokedTools !== undefined ? { revokedTools } : {}),
      ...(sanitizedState !== undefined ? { sanitizedState } : {}),
      ...(respawnRequired !== undefined ? { respawnRequired } : {}),
    };

    if (this.options.onViolation) {
      this.options.onViolation(violation, result);
    }

    return result;
  }

  public isToolPermitted(agentId: string, role: string, toolName: string): boolean {
    const state = this.getAgentState(agentId);

    if (state.isTerminated) {
      return false;
    }

    const norm = normalizeToolName(toolName);

    if (state.capabilitiesRevoked) {
      if (this.isRevokedTool(norm)) {
        return false;
      }
      if (this.isAllowedSupervisoryTool(norm)) {
        return true;
      }
      return false;
    }

    return true;
  }

  public isRevokedTool(toolName: string): boolean {
    const norm = normalizeToolName(toolName);
    if (this.revokedToolsList.includes(norm)) {
      return true;
    }
    return /(?:^|[-_])(?:write|edit|replace|mutation|mutate|delete|patch)(?:[-_]|$)/u.test(norm);
  }

  public isAllowedSupervisoryTool(toolName: string): boolean {
    const norm = normalizeToolName(toolName);
    if (this.allowedSupervisoryToolsSet.has(norm)) {
      return true;
    }
    return (
      norm.startsWith("mcp_") ||
      norm.startsWith("dag:") ||
      norm.startsWith("msg:") ||
      norm.startsWith("doctor:")
    );
  }

  public getAgentState(agentId: string): AgentContainmentState {
    const existing = this.agentStates.get(agentId);
    if (existing) {
      return {
        agentId: existing.agentId,
        role: existing.role,
        strikeCount: existing.strikeCount,
        violations: [...existing.violations],
        capabilitiesRevoked: existing.capabilitiesRevoked,
        revokedTools: [...existing.revokedTools],
        isTerminated: existing.isTerminated,
        ...(existing.lastViolationAt !== undefined
          ? { lastViolationAt: existing.lastViolationAt }
          : {}),
      };
    }

    return {
      agentId,
      role: "unknown",
      strikeCount: 0,
      violations: [],
      capabilitiesRevoked: false,
      revokedTools: [],
      isTerminated: false,
    };
  }

  public getAllAgentStates(): readonly AgentContainmentState[] {
    return Array.from(this.agentStates.values()).map((state) => ({
      agentId: state.agentId,
      role: state.role,
      strikeCount: state.strikeCount,
      violations: [...state.violations],
      capabilitiesRevoked: state.capabilitiesRevoked,
      revokedTools: [...state.revokedTools],
      isTerminated: state.isTerminated,
      ...(state.lastViolationAt !== undefined ? { lastViolationAt: state.lastViolationAt } : {}),
    }));
  }

  public getViolations(agentId: string): readonly SupervisoryViolation[] {
    const state = this.agentStates.get(agentId);
    return state ? [...state.violations] : [];
  }

  public registerAgent(agentId: string, role: string): AgentContainmentState {
    const existing = this.agentStates.get(agentId);
    if (existing) {
      return this.getAgentState(agentId);
    }
    const newState: AgentContainmentState = {
      agentId,
      role,
      strikeCount: 0,
      violations: [],
      capabilitiesRevoked: false,
      revokedTools: [],
      isTerminated: false,
    };
    this.agentStates.set(agentId, newState);
    return newState;
  }

  public resetStrikes(agentId: string): void {
    const existing = this.agentStates.get(agentId);
    if (existing) {
      this.agentStates.set(agentId, {
        ...existing,
        strikeCount: 0,
        capabilitiesRevoked: false,
        revokedTools: [],
        isTerminated: false,
      });
    }
  }

  public decayStrikes(agentId: string, decayBy: number = 1): void {
    const existing = this.agentStates.get(agentId);
    if (!existing) return;

    const newStrike = Math.max(0, existing.strikeCount - decayBy) as ContainmentStrike;
    const capabilitiesRevoked = newStrike >= 2;
    const isTerminated = newStrike >= 3;

    this.agentStates.set(agentId, {
      ...existing,
      strikeCount: newStrike,
      capabilitiesRevoked,
      revokedTools: capabilitiesRevoked ? this.revokedToolsList : [],
      isTerminated,
    });
  }

  public decayExpiredStrikes(ttlMs?: number, nowMs: number = Date.now()): number {
    const effectiveTtl = ttlMs ?? this.options.strikeDecayMs;
    if (effectiveTtl === undefined || effectiveTtl <= 0) {
      return 0;
    }

    let decayedCount = 0;
    for (const [agentId, state] of this.agentStates.entries()) {
      if (state.strikeCount > 0 && state.lastViolationAt) {
        const violationTime = Date.parse(state.lastViolationAt);
        if (Number.isFinite(violationTime) && nowMs - violationTime >= effectiveTtl) {
          this.decayStrikes(agentId, 1);
          decayedCount++;
        }
      }
    }
    return decayedCount;
  }

  public clear(): void {
    this.agentStates.clear();
  }

  public serialize(): string {
    const data: SerializedContainmentEngine = {
      version: 1,
      agentStates: Array.from(this.agentStates.values()),
      ...(this.options ? { options: this.options } : {}),
    };
    return JSON.stringify(data, null, 2);
  }

  public static deserialize(json: string): MechanicalContainmentEngine {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid serialized containment engine: root must be an object");
    }

    const payload = parsed as Partial<SerializedContainmentEngine>;
    if (payload.version !== 1 || !Array.isArray(payload.agentStates)) {
      throw new Error("Invalid serialized containment engine payload");
    }

    const engine = new MechanicalContainmentEngine(payload.options ?? {});
    for (const rawState of payload.agentStates) {
      if (
        rawState &&
        typeof rawState === "object" &&
        typeof rawState.agentId === "string" &&
        typeof rawState.role === "string" &&
        typeof rawState.strikeCount === "number"
      ) {
        const state: AgentContainmentState = {
          agentId: rawState.agentId,
          role: rawState.role,
          strikeCount: rawState.strikeCount as ContainmentStrike,
          violations: Array.isArray(rawState.violations) ? [...rawState.violations] : [],
          capabilitiesRevoked: Boolean(rawState.capabilitiesRevoked),
          revokedTools: Array.isArray(rawState.revokedTools) ? [...rawState.revokedTools] : [],
          isTerminated: Boolean(rawState.isTerminated),
          ...(typeof rawState.lastViolationAt === "string"
            ? { lastViolationAt: rawState.lastViolationAt }
            : {}),
        };
        engine.agentStates.set(state.agentId, state);
      }
    }
    return engine;
  }
}
