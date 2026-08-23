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

export const ANTIGRAVITY_CAPABILITIES: HostCapabilities = {
  provider: "antigravity",
  displayName: "Antigravity CLI / IDE",
  mechanicalToolName: "invoke_subagent",
  supportsMechanicalDispatch: true,
  supportsCognitiveFallback: true,
  maxSpawnDepth: 3,
  maxConcurrentSubagents: 8,
  supportedWorkspaceIsolation: ["inherit", "branch", "share"],
  supportsNativeResume: true,
  supportsPerAgentModel: true,
  supportsPerAgentReasoningEffort: true,
  supportsDirectMessaging: true,
};

export class AntigravityHostAdapter implements HostAdapter {
  public readonly provider: HostProvider = "antigravity";
  public readonly capabilities: HostCapabilities = ANTIGRAVITY_CAPABILITIES;

  public dispatchMechanical(packet: SubagentDispatchPacket): MechanicalDispatchResult {
    const workspace =
      packet.workspaceMode && packet.workspaceMode !== "none" ? packet.workspaceMode : "inherit";

    const toolArgs = {
      agent_name: packet.agentId,
      task_description: packet.taskDescription,
      workspace,
      ...(packet.reusedSubagentId ? { reused_subagent_id: packet.reusedSubagentId } : {}),
      ...(packet.extraInstructions ? { extra_instructions: packet.extraInstructions } : {}),
    };

    const invocationSnippet = `invoke_subagent(${JSON.stringify(toolArgs, null, 2)})`;

    return {
      mode: "mechanical",
      provider: this.provider,
      toolName: "invoke_subagent",
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
      `# [AUTHORITATIVE SUBAGENT DISPATCH DIRECTIVE — ANTIGRAVITY HOST]`,
      `**Agent ID**: \`${packet.agentId}\``,
      `**Assigned Role**: \`${packet.role}\``,
      `**Run Capsule**: \`${packet.runRoot}\``,
      `**Task ID**: \`${taskId}\``,
      `**Write Scope**: \`${packet.writeScope.join(", ") || "disjoint-scope"}\``,
      "",
      `## 1. MANDATORY ATOMIC CLI ACTION REGISTRATION`,
      `Before modifying any file, you MUST immediately execute the atomic registration sequence:`,
      "```bash",
      `# Step 1: Register Agent Identity in Harness Ledger`,
      cliSeq.registerCommand,
      "",
      `# Step 2: Claim Task Lease & Secure Bearer Token`,
      cliSeq.claimCommand,
      "```",
      "",
      `## 2. TASK EXECUTION MANDATE`,
      packet.taskDescription,
      "",
      packet.extraInstructions
        ? `### Additional Context & Rules\n${packet.extraInstructions}\n`
        : "",
      `## 3. MANDATORY TASK SUBMISSION`,
      `Upon completing implementation and verifying all scoped unit gates:`,
      "```bash",
      `# Step 3: Submit Completed Task with Evidence`,
      cliSeq.submitCommand,
      "```",
      "",
      `## 4. INVARIANTS`,
      `- 0 TypeScript any, 0 @ts-ignore / @ts-expect-error / eslint-disable.`,
      `- Run ONLY scoped unit tests for write scope: \`${packet.writeScope.join(", ") || "."}\`.`,
      `- Report progress back via send_message to coordinator.`,
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
