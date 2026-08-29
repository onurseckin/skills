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

const CODEX_ROLE_DISPATCH_DEFAULTS: Readonly<
  Record<AgentRole, { model: string; reasoningEffort: "high" | "xhigh" }>
> = {
  mind: { model: "gpt-5.6-sol", reasoningEffort: "xhigh" },
  orchestrator: { model: "gpt-5.6-sol", reasoningEffort: "high" },
  coordinator: { model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
  implementer: { model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
  planner: { model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
  repairer: { model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
  "sub-implementer": { model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
  "sub-investigator": { model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
  "completeness-critic": { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
  "mechanic-validator": { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
  "meta-auditor": { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
  "mind-auditor": { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
  "skill-auditor": { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
  "plan-validator": { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
  "sub-validator": { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
  validator: { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
};

export const CODEX_CAPABILITIES: HostCapabilities = {
  provider: "codex",
  displayName: "Codex Multi-Agent Environment",
  mechanicalToolName: "spawn_agent",
  supportsMechanicalDispatch: true,
  supportsCognitiveFallback: true,
  maxSpawnDepth: 4,
  // Codex publishes the real per-session ceiling at runtime. A static guessed value causes
  // completed/pending-init native threads to be counted as permanently capacity-consuming.
  maxConcurrentSubagents: null,
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
    const releaseCommand = `bun harness.ts agent:release --run ${packet.runRoot} --agent ${packet.agentId} --reason "task submitted"`;

    const taskName =
      packet.agentId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "codex_worker";
    const defaults = CODEX_ROLE_DISPATCH_DEFAULTS[packet.role];
    const model = packet.model ?? defaults.model;
    const reasoningEffort = packet.thinkingLevel ?? defaults.reasoningEffort;
    const message = [
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
      ...(packet.extraInstructions ? ["", "EXTENDED REQUIREMENTS:", packet.extraInstructions] : []),
      "",
      `SUBMISSION:`,
      cliSeq.submitCommand,
      releaseCommand,
    ].join("\n");
    const toolArgs = {
      task_name: taskName,
      message,
      // A packet is the canonical briefing; inheriting a partial parent transcript risks stale
      // role instructions and burns a native concurrency slot before the worker can register.
      fork_turns: "none",
      model,
      reasoning_effort: reasoningEffort,
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
    const releaseCommand = `bun harness.ts agent:release --run ${packet.runRoot} --agent ${packet.agentId} --reason "task submitted"`;
    const defaults = CODEX_ROLE_DISPATCH_DEFAULTS[packet.role];
    const model = packet.model ?? defaults.model;
    const reasoningEffort = packet.thinkingLevel ?? defaults.reasoningEffort;

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
      `**Model**: \`${model}\` | **Reasoning Effort**: \`${reasoningEffort}\``,
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
      releaseCommand,
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
