import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentTranscriptTelemetry } from "../../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "transcript-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("workflow/agents/transcript-telemetry", () => {
  test("returns null when CLAUDE_CODE_SESSION_ID is unset or whitespace", () => {
    expect(readAgentTranscriptTelemetry("agent-1", { env: {} })).toBeNull();
    expect(
      readAgentTranscriptTelemetry("agent-1", {
        env: { CLAUDE_CODE_SESSION_ID: "   " },
      }),
    ).toBeNull();
  });

  test("returns null when homeDir is unresolved or session directories not found", () => {
    expect(
      readAgentTranscriptTelemetry("agent-1", {
        homeDir: "/nonexistent/path/for/home",
        env: { CLAUDE_CODE_SESSION_ID: "sess-123" },
      }),
    ).toBeNull();
  });

  test("parses full direct transcript and meta file with tool uses, errors, token cache and timestamps", () => {
    withTempDir((homeDir) => {
      const sessionId = "sess-abc";
      const projectSlug = "test-project";
      const sessionDir = join(homeDir, ".claude", "projects", projectSlug, sessionId);
      const subagentsDir = join(sessionDir, "subagents");
      mkdirSync(subagentsDir, { recursive: true });

      const agentId = "agent-xyz";
      const jsonlPath = join(subagentsDir, `agent-${agentId}.jsonl`);
      const metaPath = join(subagentsDir, `agent-${agentId}.meta.json`);

      // Write .meta.json
      writeFileSync(
        metaPath,
        JSON.stringify({
          agentType: "critic",
          parentAgentId: "agent-parent",
          spawnDepth: 2.7, // test Math.trunc
        }),
      );

      // Write .jsonl with assistant and user tool interactions, token usages, thinking level
      const lines = [
        "", // empty line
        "invalid json line",
        JSON.stringify(123), // non-record
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-08-20T10:00:00.000Z",
          effort: "high",
          message: {
            model: "claude-3-7-sonnet",
            usage: {
              input_tokens: 150,
              output_tokens: 50,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 20,
              cache_creation: {
                ephemeral_5m_input_tokens: 60,
                ephemeral_1h_input_tokens: 40,
              },
            },
            content: [
              { type: "tool_use", id: "call-1", name: "view_file" },
              { type: "tool_use", id: "call-2", name: "run_command" },
              { type: "other", text: "hello" },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-08-20T10:00:05.000Z",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "call-1", is_error: false },
              { type: "tool_result", tool_use_id: "call-2", is_error: true },
              { type: "tool_result", tool_use_id: "call-unknown" },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-08-20T10:00:10.000Z",
          effort: "invalid_effort_level",
          message: {
            model: "claude-3-7-sonnet",
            usage: {
              input_tokens: 50,
              output_tokens: 25,
            },
            content: [{ type: "tool_use", id: "call-3", name: "run_command" }],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-08-20T10:00:15.000Z",
          toolUseResult: "Error: command failed with exit code 1",
          message: {
            content: [{ type: "tool_result", tool_use_id: "call-3" }],
          },
        }),
      ];
      writeFileSync(jsonlPath, lines.join("\n"));

      // Also create workflows directory with wf_1.json matching run context
      const workflowsDir = join(sessionDir, "workflows");
      mkdirSync(workflowsDir, { recursive: true });
      writeFileSync(
        join(workflowsDir, "wf_test.json"),
        JSON.stringify({
          runId: "wf-run-99",
          defaultModel: "claude-3-7-sonnet",
          totalTokens: 1000,
          totalToolCalls: 12,
          status: "completed",
          workflowProgress: [
            { agentId: "agent-xyz", step: 1 },
            { agentId: "other-agent", step: 2 },
          ],
        }),
      );

      const telemetry = readAgentTranscriptTelemetry(agentId, {
        homeDir,
        env: { CLAUDE_CODE_SESSION_ID: sessionId },
      });

      expect(telemetry).not.toBeNull();
      expect(telemetry!.sourcePath).toBe(jsonlPath);
      expect(telemetry!.model).toBe("claude-3-7-sonnet");
      expect(telemetry!.thinkingLevel).toBe("high");
      expect(telemetry!.tokensIn).toBe(200);
      expect(telemetry!.tokensOut).toBe(75);
      expect(telemetry!.tokenExtras).toEqual({
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_ephemeral_5m_input_tokens: 60,
        cache_creation_ephemeral_1h_input_tokens: 40,
      });
      expect(telemetry!.tools).toEqual([
        { name: "view_file", calls: 1, failures: 0 },
        { name: "run_command", calls: 2, failures: 2 },
      ]);
      expect(telemetry!.agentType).toBe("critic");
      expect(telemetry!.parentAgentId).toBe("agent-parent");
      expect(telemetry!.spawnDepth).toBe(2);
      expect(telemetry!.durationMs).toBe(15000);
      expect(telemetry!.runContext).toEqual({
        runId: "wf-run-99",
        defaultModel: "claude-3-7-sonnet",
        totalTokens: 1000,
        totalToolCalls: 12,
        status: "completed",
      });
    });
  });
});
