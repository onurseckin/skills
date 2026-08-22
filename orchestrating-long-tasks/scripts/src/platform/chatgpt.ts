import type { AgentRole } from "../contracts/packets.ts";
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

export const CHATGPT_CAPABILITIES: HostCapabilities = {
  provider: "chatgpt",
  displayName: "ChatGPT / OpenAI Advanced Platform",
  mechanicalToolName: "chatgpt_subagent_call",
  supportsMechanicalDispatch: true,
  supportsCognitiveFallback: true,
  maxSpawnDepth: 2,
  maxConcurrentSubagents: 4,
  supportedWorkspaceIsolation: ["none"],
  supportsNativeResume: false,
  supportsPerAgentModel: true,
  supportsPerAgentReasoningEffort: true,
  supportsDirectMessaging: false,
};

export class ChatGptHostAdapter implements HostAdapter {
  public readonly provider: HostProvider = "chatgpt";
  public readonly capabilities: HostCapabilities = CHATGPT_CAPABILITIES;

  public dispatchMechanical(packet: SubagentDispatchPacket): MechanicalDispatchResult {
    const taskId = packet.taskId ?? "unspecified-task";
    const cliSeq = this.buildMandatoryCliSequence(
      packet.runRoot,
      packet.agentId,
      packet.role,
      taskId,
    );

    const toolArgs = {
      name: "execute_subagent_task",
      arguments: {
        agent_id: packet.agentId,
        role: packet.role,
        capsule_root: packet.runRoot,
        task_id: taskId,
        write_scope: packet.writeScope,
        instructions: packet.taskDescription,
        mandatory_registration: {
          register: cliSeq.registerCommand,
          claim: cliSeq.claimCommand,
          submit: cliSeq.submitCommand,
        },
      },
    };

    const invocationSnippet = `chatgpt_subagent_call(${JSON.stringify(toolArgs, null, 2)})`;

    return {
      mode: "mechanical",
      provider: this.provider,
      toolName: "chatgpt_subagent_call",
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
      `# [AUTHORITATIVE SUBAGENT DISPATCH DIRECTIVE — CHATGPT HOST]`,
      `**System Role Directive**: You are executing as subagent \`${packet.agentId}\` in role \`${packet.role}\`.`,
      `**Capsule Path**: \`${packet.runRoot}\``,
      `**Task**: \`${taskId}\``,
      `**Disjoint Write Scope**: \`${packet.writeScope.join(", ") || "disjoint-scope"}\``,
      "",
      `## 1. MANDATORY ATOMIC CLI ACTION REGISTRATION`,
      `You MUST execute the harness CLI lifecycle registration before performing code edits:`,
      "```bash",
      `# Register Agent in Ledger`,
      cliSeq.registerCommand,
      "",
      `# Claim Task Lease`,
      cliSeq.claimCommand,
      "```",
      "",
      `## 2. TASK OBJECTIVES`,
      packet.taskDescription,
      "",
      packet.extraInstructions ? `### Context Notes\n${packet.extraInstructions}\n` : "",
      `## 3. MANDATORY COMPLETION SUBMISSION`,
      `Verify tests and submit task:`,
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
