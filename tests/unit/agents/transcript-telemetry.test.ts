import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readAgentTranscriptTelemetry } from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/transcript-telemetry.ts";
import { cleanupRoots } from "./fixture.ts";
import { assistantLine, mktemp, toolResultLine, writeDirectTranscript } from "./transcript-fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

describe("readAgentTranscriptTelemetry — fail-safe absence", () => {
  test("no session id in the environment reads as no evidence, not an error", () => {
    expect(readAgentTranscriptTelemetry("agent-x", { homeDir: "/nonexistent", env: {} })).toBeNull();
  });

  test("a session id with no matching project directory reads as no evidence", async () => {
    const home = await mktemp(roots);
    expect(
      readAgentTranscriptTelemetry("agent-x", {
        homeDir: home,
        env: { CLAUDE_CODE_SESSION_ID: "ghost-session" },
      }),
    ).toBeNull();
  });

  test("a real session with no file for this exact agent id reads as no evidence", async () => {
    const home = await mktemp(roots);
    await writeDirectTranscript(home, "session-a", "agent-known", [
      assistantLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-sonnet-5" }),
    ]);
    expect(
      readAgentTranscriptTelemetry("agent-unknown", {
        homeDir: home,
        env: { CLAUDE_CODE_SESSION_ID: "session-a" },
      }),
    ).toBeNull();
  });
});

describe("readAgentTranscriptTelemetry — a direct Task-tool subagent transcript", () => {
  test("real model, effort, token totals and tool success/failure are read off the transcript", async () => {
    const home = await mktemp(roots);
    await writeDirectTranscript(
      home,
      "session-b",
      "agent-1",
      [
        assistantLine({
          timestamp: "2026-08-20T10:00:00.000Z",
          model: "claude-sonnet-5",
          effort: "high",
          inputTokens: 100,
          outputTokens: 20,
          cacheRead: 5,
          toolUseId: "toolu_1",
          toolName: "Bash",
        }),
        toolResultLine({ timestamp: "2026-08-20T10:00:01.000Z", toolUseId: "toolu_1", isError: false }),
        assistantLine({
          timestamp: "2026-08-20T10:00:02.000Z",
          model: "claude-sonnet-5",
          inputTokens: 50,
          outputTokens: 10,
          toolUseId: "toolu_2",
          toolName: "Bash",
        }),
        toolResultLine({
          timestamp: "2026-08-20T10:00:03.000Z",
          toolUseId: "toolu_2",
          isError: true,
          toolUseResult: "Error: exit code 1",
        }),
        "this is not json and must be skipped, not thrown",
      ],
      { agentType: "general-purpose", spawnDepth: 1 },
    );

    const result = readAgentTranscriptTelemetry("agent-1", {
      homeDir: home,
      env: { CLAUDE_CODE_SESSION_ID: "session-b" },
    });

    expect(result).not.toBeNull();
    expect(result?.model).toBe("claude-sonnet-5");
    expect(result?.thinkingLevel).toBe("high");
    expect(result?.tokensIn).toBe(150);
    expect(result?.tokensOut).toBe(30);
    expect(result?.tokenExtras?.cache_read_input_tokens).toBe(5);
    expect(result?.tools).toEqual([{ name: "Bash", calls: 2, failures: 1 }]);
    expect(result?.durationMs).toBe(3000);
    expect(result?.agentType).toBe("general-purpose");
    expect(result?.spawnDepth).toBe(1);
    // spawnDepth 1 means no parent recorded — a top-level agent has no lineage above it to read.
    expect(result?.parentAgentId).toBeUndefined();
    expect(result?.runContext).toBeUndefined();
  });

  test("a missing meta file still yields the transcript's own numbers", async () => {
    const home = await mktemp(roots);
    await writeDirectTranscript(home, "session-c", "agent-2", [
      assistantLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-opus-5", inputTokens: 1 }),
    ]);
    const result = readAgentTranscriptTelemetry("agent-2", {
      homeDir: home,
      env: { CLAUDE_CODE_SESSION_ID: "session-c" },
    });
    expect(result?.model).toBe("claude-opus-5");
    expect(result?.agentType).toBeUndefined();
    expect(result?.spawnDepth).toBeUndefined();
  });

  test("a nested subagent's meta names its parent, and it survives the read", async () => {
    const home = await mktemp(roots);
    await writeDirectTranscript(
      home,
      "session-d",
      "agent-3",
      [assistantLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-sonnet-5" })],
      { agentType: "Explore", parentAgentId: "agent-parent", spawnDepth: 2 },
    );
    const result = readAgentTranscriptTelemetry("agent-3", {
      homeDir: home,
      env: { CLAUDE_CODE_SESSION_ID: "session-d" },
    });
    expect(result?.parentAgentId).toBe("agent-parent");
    expect(result?.spawnDepth).toBe(2);
  });
});

describe("readAgentTranscriptTelemetry — a Workflow-tool subagent, with its run aggregate", () => {
  async function writeWorkflowTranscript(
    homeDir: string,
    sessionId: string,
    runId: string,
    agentId: string,
  ): Promise<void> {
    const runDir = join(
      homeDir,
      ".claude",
      "projects",
      "some-project",
      sessionId,
      "subagents",
      "workflows",
      runId,
    );
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, `agent-${agentId}.jsonl`),
      assistantLine({
        timestamp: "2026-08-20T11:00:00.000Z",
        model: "claude-sonnet-5",
        inputTokens: 10,
        outputTokens: 5,
      }) + "\n",
    );
    await writeFile(
      join(runDir, `agent-${agentId}.meta.json`),
      JSON.stringify({ agentType: "workflow-subagent", spawnDepth: 1 }),
    );
    const workflowsDir = join(homeDir, ".claude", "projects", "some-project", sessionId, "workflows");
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(
      join(workflowsDir, `${runId}.json`),
      JSON.stringify({
        runId,
        defaultModel: "claude-opus-5[1m]",
        totalTokens: 999,
        totalToolCalls: 42,
        status: "completed",
        workflowProgress: [
          { type: "workflow_phase", index: 1, title: "Fix" },
          { type: "workflow_agent", agentId, model: "claude-sonnet-5", state: "done" },
        ],
      }),
    );
  }

  test("the run aggregate's defaultModel and totals ride along as run context", async () => {
    const home = await mktemp(roots);
    await writeWorkflowTranscript(home, "session-e", "wf_test1", "agent-4");
    const result = readAgentTranscriptTelemetry("agent-4", {
      homeDir: home,
      env: { CLAUDE_CODE_SESSION_ID: "session-e" },
    });
    expect(result?.tokensIn).toBe(10);
    expect(result?.runContext).toEqual({
      runId: "wf_test1",
      defaultModel: "claude-opus-5[1m]",
      totalTokens: 999,
      totalToolCalls: 42,
      status: "completed",
    });
  });
});
