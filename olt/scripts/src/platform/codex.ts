import type { AgentRole } from "../core/contracts/packets.ts";
import { buildMandatoryCliSequence } from "./cli-registration.ts";
import type {
  CognitiveFallbackPromptResult,
  DispatchResult,
  HostAdapter,
  HostCapabilities,
  HostProvider,
  MandatoryCliActionSequence,
  MechanicalDispatchResult,
  SubagentDispatchPacket,
} from "./types.ts";

export const CODEX_CAPABILITIES: HostCapabilities = {
  provider: "codex",
  displayName: "Codex Multi-Agent Environment",
  mechanicalToolName: "spawn_agent",
  supportsMechanicalDispatch: true,
  supportsCognitiveFallback: true,
  maxSpawnDepth: 4,
  maxConcurrentSubagents: 10,
  supportedWorkspaceIsolation: ["none"],
  supportsNativeResume: true,
  supportsPerAgentModel: true,
  supportsPerAgentReasoningEffort: true,
  supportsDirectMessaging: true,
};

export class CodexHostAdapter implements HostAdapter {
  public readonly provider: HostProvider = "codex";
  public readonly capabilities: HostCapabilities = CODEX_CAPABILITIES;

  public dispatchMechanical(packet: SubagentDispatchPacket): MechanicalDispatchResult {
    const taskId = packet.taskId ?? "unspecified-task";
    const cliSeq = this.buildMandatoryCliSequence(
      packet.runRoot,
      packet.agentId,
      packet.role,
      taskId,
    );

    const toolArgs = {
      agent_id: packet.agentId,
      role: packet.role,
      task_path: `/root/${packet.parentAgentId ?? "coordinator"}/${packet.agentId}`,
      prompt: [
        `You are Codex worker ${packet.agentId} (${packet.role}).`,
        `Run: ${packet.runRoot} | Task: ${taskId}`,
        `Write Scope: ${packet.writeScope.join(", ")}`,
        "",
        `MANDATORY CLI REGISTRATION:`,
        cliSeq.registerCommand,
        cliSeq.claimCommand,
        "",
        `TASK MANDATE:`,
        packet.taskDescription,
        "",
        `SUBMISSION:`,
        cliSeq.submitCommand,
      ].join("\n"),
      ...(packet.modelTier ? { model: packet.modelTier } : {}),
      ...(packet.thinkingLevel ? { reasoning_effort: packet.thinkingLevel } : {}),
      fork_context: false,
    };

    const invocationSnippet = `spawn_agent(${JSON.stringify(toolArgs, null, 2)})`;

    return {
      mode: "mechanical",
      provider: this.provider,
      toolName: "spawn_agent",
      toolArguments: toolArgs,
      invocationSnippet,
      timestamp: new Date().toISOString(),
    };
  }

  public generateCognitiveFallbackPrompt(
    packet: SubagentDispatchPacket,
  ): CognitiveFallbackPromptResult {
    const taskId = packet.taskId ?? "unspecified-task";
    const cliSeq = this.buildMandatoryCliSequence(
      packet.runRoot,
      packet.agentId,
      packet.role,
      taskId,
    );

    const mandatoryCliCommands = [
      cliSeq.registerCommand,
      cliSeq.claimCommand,
      cliSeq.heartbeatCommand,
      cliSeq.submitCommand,
    ];

    const prompt = [
      `# [AUTHORITATIVE SUBAGENT DISPATCH DIRECTIVE — CODEX HOST]`,
      `[features.multi_agent = true]`,
      `**Agent**: \`${packet.agentId}\` | **Role**: \`${packet.role}\``,
      `**Model**: \`${packet.modelTier ?? "default"}\` | **Reasoning Effort**: \`${packet.thinkingLevel ?? "high"}\``,
      `**Run Root**: \`${packet.runRoot}\``,
      `**Task**: \`${taskId}\``,
      `**Write Scope**: \`${packet.writeScope.join(", ") || "disjoint-scope"}\``,
      "",
      `## 1. MANDATORY ATOMIC CLI ACTION REGISTRATION`,
      `Execute atomic lifecycle registration via shell:`,
      "```bash",
      cliSeq.registerCommand,
      cliSeq.claimCommand,
      "```",
      "",
      `## 2. TASK IMPLEMENTATION INSTRUCTIONS`,
      packet.taskDescription,
      "",
      packet.extraInstructions ? `### Extended Requirements\n${packet.extraInstructions}\n` : "",
      `## 3. TASK COMPLETION & SUBMISSION`,
      "```bash",
      cliSeq.submitCommand,
      "```",
    ].join("\n");

    return {
      mode: "cognitive_fallback",
      provider: this.provider,
      prompt,
      structuredInstructions: packet.taskDescription,
      mandatoryCliCommands,
      timestamp: new Date().toISOString(),
    };
  }

  public dispatch(
    packet: SubagentDispatchPacket,
    options?: { forceCognitiveFallback?: boolean },
  ): DispatchResult {
    if (options?.forceCognitiveFallback) {
      return this.generateCognitiveFallbackPrompt(packet);
    }
    return this.dispatchMechanical(packet);
  }

  public buildMandatoryCliSequence(
    runRoot: string,
    agentId: string,
    role: AgentRole,
    taskId: string,
  ): MandatoryCliActionSequence {
    return buildMandatoryCliSequence(runRoot, agentId, role, taskId, this.provider);
  }
}
