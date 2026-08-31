import { describe, expect, test } from "bun:test";
import {
  AntigravityHostAdapter,
  ClaudeCodeHostAdapter,
  getHostAdapter,
  listHostCapabilities,
  listSupportedHostProviders,
  resolveHostProvider,
  type SubagentDispatchPacket,
} from "../../../olt/scripts/src/platform/index.ts";

describe("Host Adapters Core — Provider Registry, Antigravity & Claude Code", () => {
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
  });

  test("resolveHostProvider never silently defaults absent or unrecognized input to a specific vendor", () => {
    expect(resolveHostProvider("")).toBe("unknown");
    expect(resolveHostProvider(null)).toBe("unknown");
    expect(resolveHostProvider(undefined)).toBe("unknown");
    expect(resolveHostProvider("some-future-host-nobody-has-heard-of")).toBe("unknown");
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

  test("getHostAdapter throws INVALID_ARGUMENT on unknown host provider", () => {
    expect(() =>
      getHostAdapter(
        "unknown-host" as unknown as import("../../../olt/scripts/src/platform/index.ts").HostProvider,
      ),
    ).toThrow(/Unsupported host provider/);
  });
});
