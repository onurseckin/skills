import { describe, expect, test } from "bun:test";
import {
  AntigravityHostAdapter,
  ClaudeCodeHostAdapter,
  CursorHostAdapter,
  CodexHostAdapter,
  ChatGptHostAdapter,
  dispatchSubagent,
  getHostAdapter,
  listHostCapabilities,
  listSupportedHostProviders,
  resolveHostProvider,
  type SubagentDispatchPacket,
} from "../../../orchestrating-long-tasks/scripts/src/platform/index.ts";

describe("Host Adapters Architecture — Mechanical-First, Cognitive-Fallback", () => {
  const samplePacket: SubagentDispatchPacket = {
    agentId: "impl-worker-1",
    role: "implementer",
    runRoot: ".capsules/test-run-1",
    taskId: "task-42",
    taskDescription: "Implement strict POSIX flock concurrency primitives.",
    writeScope: ["orchestrating-long-tasks/scripts/src/platform/"],
    modelTier: "m",
    thinkingLevel: "high",
  };

  test("listSupportedHostProviders returns all 5 canonical providers", () => {
    const providers = listSupportedHostProviders();
    expect(providers).toEqual(["antigravity", "claude-code", "cursor", "codex", "chatgpt"]);
  });

  test("listHostCapabilities returns capability descriptors for all 5 providers", () => {
    const capabilities = listHostCapabilities();
    expect(capabilities.length).toBe(5);
    expect(capabilities.map((c) => c.provider)).toEqual([
      "antigravity",
      "claude-code",
      "cursor",
      "codex",
      "chatgpt",
    ]);
  });

  test("resolveHostProvider normalizes various vendor names correctly", () => {
    expect(resolveHostProvider("antigravity")).toBe("antigravity");
    expect(resolveHostProvider("gemini-cli")).toBe("antigravity");
    expect(resolveHostProvider("claude-code")).toBe("claude-code");
    expect(resolveHostProvider("anthropic-agent")).toBe("claude-code");
    expect(resolveHostProvider("cursor-ide")).toBe("cursor");
    expect(resolveHostProvider("codex")).toBe("codex");
    expect(resolveHostProvider("openai-codex")).toBe("codex");
    expect(resolveHostProvider("chatgpt")).toBe("chatgpt");
    expect(resolveHostProvider("openai-gpt4")).toBe("chatgpt");
    expect(resolveHostProvider("")).toBe("antigravity");
    expect(resolveHostProvider(null)).toBe("antigravity");
  });

  describe("Antigravity Host Adapter", () => {
    const adapter = new AntigravityHostAdapter();

    test("capabilities reflect Antigravity specifications", () => {
      expect(adapter.capabilities.provider).toBe("antigravity");
      expect(adapter.capabilities.mechanicalToolName).toBe("invoke_subagent");
      expect(adapter.capabilities.supportsMechanicalDispatch).toBeTrue();
      expect(adapter.capabilities.supportsCognitiveFallback).toBeTrue();
      expect(adapter.capabilities.supportedWorkspaceIsolation).toContain("branch");
      expect(adapter.capabilities.supportsNativeResume).toBeTrue();
    });

    test("mechanical dispatch formats invoke_subagent tool payload", () => {
      const res = adapter.dispatchMechanical({
        ...samplePacket,
        workspaceMode: "branch",
        reusedSubagentId: "subagent-old-123",
      });

      expect(res.mode).toBe("mechanical");
      expect(res.provider).toBe("antigravity");
      expect(res.toolName).toBe("invoke_subagent");
      expect(res.toolArguments.agent_name).toBe("impl-worker-1");
      expect(res.toolArguments.workspace).toBe("branch");
      expect(res.toolArguments.reused_subagent_id).toBe("subagent-old-123");
      expect(res.invocationSnippet).toContain("invoke_subagent");
    });

    test("cognitive fallback prompt enforces role, invariants, and mandatory CLI sequence", () => {
      const res = adapter.generateCognitiveFallbackPrompt(samplePacket);

      expect(res.mode).toBe("cognitive_fallback");
      expect(res.provider).toBe("antigravity");
      expect(res.prompt).toContain(
        "[AUTHORITATIVE SUBAGENT DISPATCH DIRECTIVE — ANTIGRAVITY HOST]",
      );
      expect(res.prompt).toContain("agent:register");
      expect(res.prompt).toContain("task:claim");
      expect(res.prompt).toContain("task:submit");
      expect(res.prompt).toContain("0 TypeScript any");
      expect(res.mandatoryCliCommands.length).toBe(4);
    });

    test("dispatch default prefers mechanical, respects forceCognitiveFallback", () => {
      const mech = adapter.dispatch(samplePacket);
      expect(mech.mode).toBe("mechanical");

      const cog = adapter.dispatch(samplePacket, { forceCognitiveFallback: true });
      expect(cog.mode).toBe("cognitive_fallback");
    });
  });

  describe("Claude Code Host Adapter", () => {
    const adapter = new ClaudeCodeHostAdapter();

    test("capabilities reflect Claude Code specifications", () => {
      expect(adapter.capabilities.provider).toBe("claude-code");
      expect(adapter.capabilities.mechanicalToolName).toBe("Agent");
      expect(adapter.capabilities.maxSpawnDepth).toBe(3);
      expect(adapter.capabilities.maxConcurrentSubagents).toBe(20);
      expect(adapter.capabilities.supportsDirectMessaging).toBeTrue();
    });

    test("mechanical dispatch formats Agent tool invocation with frontmatter and CLI registrations", () => {
      const res = adapter.dispatchMechanical(samplePacket);
      expect(res.mode).toBe("mechanical");
      expect(res.toolName).toBe("Agent");
      expect(res.toolArguments.name).toBe("impl-worker-1");
      expect(res.toolArguments.model).toBe("m");
      expect(res.toolArguments.effort).toBe("high");
    });

    test("cognitive fallback prompt formats YAML frontmatter and mandatory commands", () => {
      const res = adapter.generateCognitiveFallbackPrompt(samplePacket);
      expect(res.mode).toBe("cognitive_fallback");
      expect(res.prompt).toContain("agent_id: impl-worker-1");
      expect(res.prompt).toContain("role: implementer");
      expect(res.prompt).toContain("agent:register");
      expect(res.prompt).toContain("task:claim");
      expect(res.prompt).toContain("task:submit");
    });
  });

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

    test("capabilities reflect Codex specifications", () => {
      expect(adapter.capabilities.provider).toBe("codex");
      expect(adapter.capabilities.mechanicalToolName).toBe("spawn_agent");
      expect(adapter.capabilities.supportsNativeResume).toBeTrue();
      expect(adapter.capabilities.supportsDirectMessaging).toBeTrue();
      expect(adapter.capabilities.maxSpawnDepth).toBe(4);
    });

    test("mechanical dispatch formats spawn_agent collaboration payload", () => {
      const res = adapter.dispatchMechanical(samplePacket);
      expect(res.mode).toBe("mechanical");
      expect(res.toolName).toBe("spawn_agent");
      expect(res.toolArguments.agent_id).toBe("impl-worker-1");
      expect(res.toolArguments.role).toBe("implementer");
      expect(res.toolArguments.task_path).toContain("/root/coordinator/impl-worker-1");
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
  });

  test("getHostAdapter throws INVALID_ARGUMENT on unknown host provider", () => {
    expect(() =>
      getHostAdapter(
        "unknown-host" as unknown as import("../../../orchestrating-long-tasks/scripts/src/platform/index.ts").HostProvider,
      ),
    ).toThrow(/Unsupported host provider/);
  });
});
