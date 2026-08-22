import type { JsonObject, JsonValue } from "../contracts/json.ts";
import type { AgentRole } from "../contracts/packets.ts";
import type { AgentModelTier, ThinkingLevel } from "../contracts/agents.ts";

export type HostProvider =
  | "antigravity"
  | "claude-code"
  | "cursor"
  | "codex"
  | "chatgpt";

export const HOST_PROVIDERS: readonly HostProvider[] = [
  "antigravity",
  "claude-code",
  "cursor",
  "codex",
  "chatgpt",
];

export function isHostProvider(value: unknown): value is HostProvider {
  return typeof value === "string" && (HOST_PROVIDERS as readonly string[]).includes(value);
}

export type WorkspaceIsolationMode = "inherit" | "branch" | "share" | "none";

export interface HostCapabilities {
  readonly provider: HostProvider;
  readonly displayName: string;
  readonly mechanicalToolName: string | null;
  readonly supportsMechanicalDispatch: boolean;
  readonly supportsCognitiveFallback: boolean;
  readonly maxSpawnDepth: number;
  readonly maxConcurrentSubagents: number | null;
  readonly supportedWorkspaceIsolation: readonly WorkspaceIsolationMode[];
  readonly supportsNativeResume: boolean;
  readonly supportsPerAgentModel: boolean;
  readonly supportsPerAgentReasoningEffort: boolean;
  readonly supportsDirectMessaging: boolean;
}

export interface SubagentDispatchPacket {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly runRoot: string;
  readonly taskId?: string;
  readonly taskDescription: string;
  readonly writeScope: readonly string[];
  readonly parentAgentId?: string;
  readonly modelTier?: AgentModelTier;
  readonly thinkingLevel?: ThinkingLevel;
  readonly workspaceMode?: WorkspaceIsolationMode;
  readonly reusedSubagentId?: string;
  readonly extraInstructions?: string;
}

export interface MechanicalDispatchResult {
  readonly mode: "mechanical";
  readonly provider: HostProvider;
  readonly toolName: string;
  readonly toolArguments: Record<string, unknown>;
  readonly invocationSnippet: string;
  readonly timestamp: string;
}

export interface CognitiveFallbackPromptResult {
  readonly mode: "cognitive_fallback";
  readonly provider: HostProvider;
  readonly prompt: string;
  readonly structuredInstructions: string;
  readonly mandatoryCliCommands: readonly string[];
  readonly timestamp: string;
}

export type DispatchResult = MechanicalDispatchResult | CognitiveFallbackPromptResult;

export interface MandatoryCliActionSequence {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly runRoot: string;
  readonly taskId: string;
  readonly registerCommand: string;
  readonly claimCommand: string;
  readonly heartbeatCommand: string;
  readonly submitCommand: string;
}

export interface UnfulfilledDemandItem {
  readonly id: string;
  readonly kind: "task" | "lane" | "action" | "requirement" | "gate";
  readonly label: string;
  readonly status: string;
  readonly writeScope: readonly string[];
  readonly assignedAgentId?: string;
  readonly rootCause: string;
  readonly blockingReason: string;
  readonly remediation: string;
}

export interface UnfulfilledDemandPushbackReport {
  readonly hasUnfulfilledDemands: boolean;
  readonly totalPlanned: number;
  readonly totalUnfulfilled: number;
  readonly unfulfilledItems: readonly UnfulfilledDemandItem[];
  readonly blockingPushbackMessage?: string;
  readonly remediationPlan: readonly string[];
  readonly checkedAt: string;
}

export interface HostAdapter {
  readonly provider: HostProvider;
  readonly capabilities: HostCapabilities;
  dispatchMechanical(packet: SubagentDispatchPacket): MechanicalDispatchResult;
  generateCognitiveFallbackPrompt(packet: SubagentDispatchPacket): CognitiveFallbackPromptResult;
  dispatch(
    packet: SubagentDispatchPacket,
    options?: { forceCognitiveFallback?: boolean },
  ): DispatchResult;
  buildMandatoryCliSequence(
    runRoot: string,
    agentId: string,
    role: AgentRole,
    taskId: string,
  ): MandatoryCliActionSequence;
}
