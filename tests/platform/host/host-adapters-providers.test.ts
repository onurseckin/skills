import { describe, expect, test } from "bun:test";
import {
  AntigravityHostAdapter,
  ClaudeCodeHostAdapter,
  CursorHostAdapter,
  CodexHostAdapter,
  ChatGptHostAdapter,
  dispatchSubagent,
  type SubagentDispatchPacket,
} from "../../../olt/scripts/src/platform/index.ts";

describe("Host Adapters Providers — Cursor, Codex, ChatGPT & Dispatch Router", () => {
  const samplePacket: SubagentDispatchPacket = {
    agentId: "impl-worker-1",
    role: "implementer",
    runRoot: ".olt/capsules/test-run-1",
    taskId: "task-42",
    taskDescription: "Implement strict POSIX flock concurrency primitives.",
    writeScope: ["olt/scripts/src/platform/"],
    modelTier: "m",
    thinkingLevel: "high",
  };

  describe("Cursor Host Adapter", () => {
    const adapter = new CursorHostAdapter();

    test("capabilities reflect Cursor specifications with maxSpawnDepth 1", () => {
      expect(adapter.capabilities.provider).toBe("cursor");
      expect(adapter.capabilities.mechanicalToolName).toBe("Task");
      expect(adapter.capabilities.maxSpawnDepth).toBe(1);
    });

    test("mechanical dispatch formats Task tool invocation", () => {
      const res = adapter.dispatchMechanical(samplePacket);
      expect(res.mode).toBe("mechanical");
      expect(res.toolName).toBe("Task");
      expect(res.toolArguments.task).toContain("task-42");
    });

    test("cognitive fallback prompt contains nesting depth 1 warning and CLI commands", () => {
      const res = adapter.generateCognitiveFallbackPrompt(samplePacket);
      expect(res.mode).toBe("cognitive_fallback");
      expect(res.prompt).toContain("Max 1 Level");
      expect(res.prompt).toContain("Cursor nesting depth is capped at 1");
      expect(res.prompt).toContain("agent:register");
      expect(res.prompt).toContain("task:claim");
      expect(res.prompt).toContain("task:submit");
    });
  });

  describe("Codex Host Adapter", () => {
    const adapter = new CodexHostAdapter();

    test("uses the canonical role-model policy for native dispatches without overrides", () => {
      const policy: ReadonlyArray<
        readonly [SubagentDispatchPacket["role"], string, "high" | "xhigh"]
      > = [
        ["mind", "gpt-5.6-sol", "xhigh"],
        ["orchestrator", "gpt-5.6-sol", "high"],
        ["coordinator", "gpt-5.6-terra", "xhigh"],
        ["implementer", "gpt-5.6-terra", "xhigh"],
        ["sub-implementer", "gpt-5.6-terra", "xhigh"],
        ["sub-investigator", "gpt-5.6-terra", "xhigh"],
        ["planner", "gpt-5.6-terra", "xhigh"],
        ["repairer", "gpt-5.6-terra", "xhigh"],
        ["completeness-critic", "gpt-5.6-luna", "xhigh"],
        ["mechanic-validator", "gpt-5.6-luna", "xhigh"],
        ["skill-auditor", "gpt-5.6-luna", "xhigh"],
        ["mind-auditor", "gpt-5.6-luna", "xhigh"],
        ["plan-validator", "gpt-5.6-luna", "xhigh"],
        ["sub-validator", "gpt-5.6-luna", "xhigh"],
        ["validator", "gpt-5.6-luna", "xhigh"],
      ];

      for (const [role, model, reasoningEffort] of policy) {
        const { modelTier: _m, thinkingLevel: _t, ...rest } = samplePacket;
        const result = adapter.dispatchMechanical({
          ...rest,
          role,
        });
        expect(result.toolArguments.model).toBe(model);
        expect(result.toolArguments.reasoning_effort).toBe(reasoningEffort);
      }
    });

    test("capabilities reflect Codex specifications", () => {
      expect(adapter.capabilities.provider).toBe("codex");
      expect(adapter.capabilities.mechanicalToolName).toBe("spawn_agent");
      expect(adapter.capabilities.supportsNativeResume).toBeTrue();
      expect(adapter.capabilities.supportsDirectMessaging).toBeTrue();
      expect(adapter.capabilities.maxSpawnDepth).toBe(4);
    });

    test("mechanical dispatch uses Codex's documented spawn_agent contract", () => {
      const res = adapter.dispatchMechanical(samplePacket);
      expect(res.mode).toBe("mechanical");
      expect(res.toolName).toBe("spawn_agent");
      expect(res.toolArguments.task_name).toBe("impl_worker_1");
      expect(res.toolArguments.message).toContain("You are Codex worker impl-worker-1");
      expect(res.toolArguments.fork_turns).toBe("none");
      expect(res.toolArguments.message).toContain(
        'agent:release --run .olt/capsules/test-run-1 --agent impl-worker-1 --reason "task submitted"',
      );
      expect(res.toolArguments).not.toHaveProperty("agent_id");
      expect(res.toolArguments).not.toHaveProperty("role");
      expect(res.toolArguments).not.toHaveProperty("task_path");
      expect(res.toolArguments).not.toHaveProperty("fork_context");
    });

    test("cognitive fallback prompt includes multi_agent feature flag directive", () => {
      const res = adapter.generateCognitiveFallbackPrompt(samplePacket);
      expect(res.mode).toBe("cognitive_fallback");
      expect(res.prompt).toContain("[features.multi_agent = true]");
      expect(res.prompt).toContain("agent:register");
      expect(res.prompt).toContain("task:claim");
      expect(res.prompt).toContain("task:submit");
    });
  });

  describe("ChatGPT Host Adapter", () => {
    const adapter = new ChatGptHostAdapter();

    test("capabilities reflect ChatGPT specifications", () => {
      expect(adapter.capabilities.provider).toBe("chatgpt");
      expect(adapter.capabilities.mechanicalToolName).toBe("chatgpt_subagent_call");
      expect(adapter.capabilities.maxSpawnDepth).toBe(2);
      expect(adapter.capabilities.maxConcurrentSubagents).toBe(4);
    });

    test("mechanical dispatch formats tool call arguments", () => {
      const res = adapter.dispatchMechanical(samplePacket);
      expect(res.mode).toBe("mechanical");
      expect(res.toolName).toBe("chatgpt_subagent_call");
      expect(res.toolArguments.name).toBe("execute_subagent_task");
    });

    test("cognitive fallback prompt structures system/developer instructions", () => {
      const res = adapter.generateCognitiveFallbackPrompt(samplePacket);
      expect(res.mode).toBe("cognitive_fallback");
      expect(res.prompt).toContain("[AUTHORITATIVE SUBAGENT DISPATCH DIRECTIVE — CHATGPT HOST]");
      expect(res.prompt).toContain("agent:register");
      expect(res.prompt).toContain("task:claim");
      expect(res.prompt).toContain("task:submit");
    });
  });

  test("dispatchSubagent helper dispatches to requested provider seamlessly", () => {
    const res = dispatchSubagent("claude-code", samplePacket);
    expect(res.provider).toBe("claude-code");
    expect(res.mode).toBe("mechanical");

    const fallback = dispatchSubagent("codex", samplePacket, { forceCognitiveFallback: true });
    expect(fallback.provider).toBe("codex");
    expect(fallback.mode).toBe("cognitive_fallback");

    const adapters = [
      new AntigravityHostAdapter(),
      new ClaudeCodeHostAdapter(),
      new CursorHostAdapter(),
      new CodexHostAdapter(),
      new ChatGptHostAdapter(),
    ];

    const minimalPacket: SubagentDispatchPacket = {
      agentId: "worker-min",
      role: "validator",
      runRoot: ".olt/capsules/min",
      taskDescription: "Minimal task description",
      writeScope: [],
      extraInstructions: "Extra rule instructions",
      workspaceMode: "none",
    };

    for (const ad of adapters) {
      const mech = ad.dispatch(samplePacket);
      expect(mech.mode).toBe("mechanical");

      const cog = ad.dispatch(samplePacket, { forceCognitiveFallback: true });
      expect(cog.mode).toBe("cognitive_fallback");

      const minCog = ad.dispatch(minimalPacket, { forceCognitiveFallback: true });
      expect(minCog.mode).toBe("cognitive_fallback");

      const minMech = ad.dispatch(minimalPacket);
      expect(minMech.mode).toBe("mechanical");

      const cliSeq = ad.buildMandatoryCliSequence(
        ".olt/capsules/run",
        "agent-x",
        "implementer",
        "task-x",
      );
      expect(cliSeq.agentId).toBe("agent-x");
      expect(cliSeq.taskId).toBe("task-x");
    }
  });
});
