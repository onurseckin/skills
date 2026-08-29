import type { AgentRole } from "../../core/contracts/index.ts";
import { buildMandatoryCliSequence } from "../process/cli-registration.ts";
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

export const CLAUDE_CODE_CAPABILITIES: HostCapabilities = {
  provider: "claude-code",
  displayName: "Claude Code",
  mechanicalToolName: "Agent",
  supportsMechanicalDispatch: true,
  supportsCognitiveFallback: true,
  maxSpawnDepth: 3,
  maxConcurrentSubagents: 20,
  supportedWorkspaceIsolation: ["none"],
  supportsNativeResume: false,
  supportsPerAgentModel: true,
  supportsPerAgentReasoningEffort: true,
  supportsDirectMessaging: true,
};

export class ClaudeCodeHostAdapter implements HostAdapter {
  public readonly provider: HostProvider = "claude-code";
  public readonly capabilities: HostCapabilities = CLAUDE_CODE_CAPABILITIES;

  public dispatchMechanical(packet: SubagentDispatchPacket): MechanicalDispatchResult {
    const taskId = packet.taskId ?? "unspecified-task";
    const cliSeq = this.buildMandatoryCliSequence(
      packet.runRoot,
      packet.agentId,
      packet.role,
      taskId,
    );

    const toolArgs = {
      name: packet.agentId,
      prompt: [
        `You are Claude Code subagent ${packet.agentId} with role ${packet.role}.`,
        `Run capsule: ${packet.runRoot}`,
        `Task: ${taskId}`,
        `Write Scope: ${packet.writeScope.join(", ")}`,
        "",
        `MANDATORY CLI REGISTRATION:`,
        `1. ${cliSeq.registerCommand}`,
        `2. ${cliSeq.claimCommand}`,
        "",
        `TASK GOAL:`,
        packet.taskDescription,
        "",
        `SUBMISSION:`,
        `3. ${cliSeq.submitCommand}`,
      ].join("\n"),
      ...(packet.modelTier ? { model: packet.modelTier } : {}),
      ...(packet.thinkingLevel ? { effort: packet.thinkingLevel } : {}),
    };

    const invocationSnippet = `Agent(${JSON.stringify(toolArgs, null, 2)})`;

    return {
      mode: "mechanical",
      provider: this.provider,
      toolName: "Agent",
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
      `---`,
      `agent_id: ${packet.agentId}`,
      `role: ${packet.role}`,
      `model: ${packet.modelTier ?? "claude-3-7-sonnet"}`,
      `effort: ${packet.thinkingLevel ?? "high"}`,
      `---`,
      `# [AUTHORITATIVE SUBAGENT DISPATCH DIRECTIVE — CLAUDE CODE HOST]`,
      `You are operating as isolated subagent \`${packet.agentId}\` in Claude Code.`,
      `**Run Root**: \`${packet.runRoot}\``,
      `**Target Task**: \`${taskId}\``,
      `**Write Scope**: \`${packet.writeScope.join(", ") || "disjoint-scope"}\``,
      "",
      `## 1. MANDATORY ATOMIC CLI ACTION REGISTRATION`,
      `You must execute these commands sequentially before mutating any files:`,
      "```bash",
      cliSeq.registerCommand,
      cliSeq.claimCommand,
      "```",
      "",
      `## 2. SUBAGENT WORK INSTRUCTIONS`,
      packet.taskDescription,
      "",
      packet.extraInstructions ? `### Extra Instructions\n${packet.extraInstructions}\n` : "",
      `## 3. COMPLETION & SUBMISSION`,
      `Once scoped tests pass cleanly, register task completion:`,
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
