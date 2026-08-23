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

export const CURSOR_CAPABILITIES: HostCapabilities = {
  provider: "cursor",
  displayName: "Cursor CLI / IDE",
  mechanicalToolName: "Task",
  supportsMechanicalDispatch: true,
  supportsCognitiveFallback: true,
  maxSpawnDepth: 1,
  maxConcurrentSubagents: null,
  supportedWorkspaceIsolation: ["none"],
  supportsNativeResume: false,
  supportsPerAgentModel: false,
  supportsPerAgentReasoningEffort: false,
  supportsDirectMessaging: false,
};

export class CursorHostAdapter implements HostAdapter {
  public readonly provider: HostProvider = "cursor";
  public readonly capabilities: HostCapabilities = CURSOR_CAPABILITIES;

  public dispatchMechanical(packet: SubagentDispatchPacket): MechanicalDispatchResult {
    const taskId = packet.taskId ?? "unspecified-task";
    const cliSeq = this.buildMandatoryCliSequence(
      packet.runRoot,
      packet.agentId,
      packet.role,
      taskId,
    );

    const toolArgs = {
      task: `Execute ${packet.role} task ${taskId} (Agent: ${packet.agentId})`,
      prompt: [
        `You are Cursor subagent ${packet.agentId} (${packet.role}).`,
        `Capsule: ${packet.runRoot}`,
        `Task: ${taskId}`,
        `Write Scope: ${packet.writeScope.join(", ")}`,
        "",
        `MANDATORY CLI REGISTRATION:`,
        cliSeq.registerCommand,
        cliSeq.claimCommand,
        "",
        `INSTRUCTIONS:`,
        packet.taskDescription,
        "",
        `SUBMISSION:`,
        cliSeq.submitCommand,
      ].join("\n"),
    };

    const invocationSnippet = `Task(${JSON.stringify(toolArgs, null, 2)})`;

    return {
      mode: "mechanical",
      provider: this.provider,
      toolName: "Task",
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
      `# [AUTHORITATIVE SUBAGENT DISPATCH DIRECTIVE — CURSOR HOST]`,
      `**Agent**: \`${packet.agentId}\` | **Role**: \`${packet.role}\` | **Depth Constraint**: Max 1 Level`,
      `**Capsule**: \`${packet.runRoot}\``,
      `**Target Task**: \`${taskId}\``,
      `**Write Scope**: \`${packet.writeScope.join(", ") || "disjoint-scope"}\``,
      "",
      `## 1. MANDATORY ATOMIC CLI ACTION REGISTRATION`,
      `Execute atomic registration immediately:`,
      "```bash",
      cliSeq.registerCommand,
      cliSeq.claimCommand,
      "```",
      "",
      `## 2. DIRECT TASK EXECUTION INSTRUCTIONS`,
      packet.taskDescription,
      "",
      `## 3. TASK COMPLETION REGISTRATION`,
      "```bash",
      cliSeq.submitCommand,
      "```",
      "",
      `> [!WARNING]`,
      `> Cursor nesting depth is capped at 1. Do NOT attempt recursive subagent spawning from this worker.`,
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
