import { describe, expect, test, afterAll, spyOn } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { readAgentTranscriptTelemetry } from "../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";
import {
  assistantLine as aLine,
  cleanupTranscriptRoots,
  mktemp,
  toolResultLine as tLine,
  writeDirectTranscript as wDirect,
} from "./transcript-fixture.ts";

afterAll(async () => {
  await cleanupTranscriptRoots();
});

const getTel = (agentId: string, home: string, sess: string) =>
  readAgentTranscriptTelemetry(agentId, { homeDir: home, env: { CLAUDE_CODE_SESSION_ID: sess } });

describe("readAgentTranscriptTelemetry — fail-safe absence", () => {
  test("no session id, ghost sessions, or erroring homedir read as null", () => {
    expect(readAgentTranscriptTelemetry("a", { homeDir: "/none", env: {} })).toBeNull();
    expect(
      readAgentTranscriptTelemetry("a", { env: { CLAUDE_CODE_SESSION_ID: "ghost" } }),
    ).toBeNull();
    const home = mktemp(import.meta.path, "ghost-proj");
    expect(getTel("a", home, "ghost")).toBeNull();

    const spy = spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("homedir failure");
    });
    try {
      expect(
        readAgentTranscriptTelemetry("a", { env: { CLAUDE_CODE_SESSION_ID: "ghost" } }),
      ).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  test("a real session with no file for this exact agent id reads as no evidence", async () => {
    const home = mktemp(import.meta.path, "session-a");
    await wDirect(home, "session-a", "agent-known", [
      aLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-sonnet-5" }),
    ]);
    expect(getTel("agent-unknown", home, "session-a")).toBeNull();
  });
});

describe("readAgentTranscriptTelemetry — a direct Task-tool subagent transcript", () => {
  test("real model, effort, token totals and tool success/failure are read off transcript", async () => {
    const home = mktemp(import.meta.path, "session-b");
    await wDirect(
      home,
      "session-b",
      "agent-1",
      [
        aLine({
          timestamp: "2026-08-20T10:00:00.000Z",
          model: "claude-sonnet-5",
          effort: "high",
          inputTokens: 100,
          outputTokens: 20,
          cacheRead: 5,
          toolUseId: "t1",
          toolName: "Bash",
        }),
        tLine({ timestamp: "2026-08-20T10:00:01.000Z", toolUseId: "t1", isError: false }),
        aLine({
          timestamp: "2026-08-20T10:00:02.000Z",
          model: "claude-sonnet-5",
          inputTokens: 50,
          outputTokens: 10,
          toolUseId: "t2",
          toolName: "Bash",
        }),
        tLine({
          timestamp: "2026-08-20T10:00:03.000Z",
          toolUseId: "t2",
          isError: true,
          toolUseResult: "Error: exit code 1",
        }),
        "invalid json line to skip",
      ],
      { agentType: "general-purpose", spawnDepth: 1 },
    );

    const res = getTel("agent-1", home, "session-b");
    expect(res?.model).toBe("claude-sonnet-5");
    expect(res?.thinkingLevel).toBe("high");
    expect(res?.tokensIn).toBe(150);
    expect(res?.tokensOut).toBe(30);
    expect(res?.tokenExtras?.cache_read_input_tokens).toBe(5);
    expect(res?.tools).toEqual([{ name: "Bash", calls: 2, failures: 1 }]);
    expect(res?.durationMs).toBe(3000);
    expect(res?.agentType).toBe("general-purpose");
    expect(res?.spawnDepth).toBe(1);
    expect(res?.parentAgentId).toBeUndefined();
    expect(res?.runContext).toBeUndefined();
  });

  test("missing and malformed meta files are handled gracefully", async () => {
    const homeC = mktemp(import.meta.path, "session-c");
    await wDirect(homeC, "session-c", "agent-2", [
      aLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-opus-5", inputTokens: 1 }),
    ]);
    expect(getTel("agent-2", homeC, "session-c")?.model).toBe("claude-opus-5");

    const homeBad = mktemp(import.meta.path, "session-bad-meta");
    await wDirect(homeBad, "session-bad-meta", "agent-5", [
      aLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-sonnet-5" }),
    ]);
    const metaPath = join(
      homeBad,
      ".claude",
      "projects",
      "some-project",
      "session-bad-meta",
      "subagents",
      "agent-agent-5.meta.json",
    );
    await writeFile(metaPath, "{ bad json");
    expect(getTel("agent-5", homeBad, "session-bad-meta")?.model).toBe("claude-sonnet-5");
  });

  test("nested subagent meta, ephemeral cache buckets, and malformed run aggregates", async () => {
    const homeD = mktemp(import.meta.path, "session-d");
    await wDirect(
      homeD,
      "session-d",
      "agent-3",
      [aLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-sonnet-5" })],
      { agentType: "Explore", parentAgentId: "agent-parent", spawnDepth: 2 },
    );
    const resD = getTel("agent-3", homeD, "session-d");
    expect(resD?.parentAgentId).toBe("agent-parent");
    expect(resD?.spawnDepth).toBe(2);

    const homeCache = mktemp(import.meta.path, "session-cache-buckets");
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-20T10:00:00.000Z",
      message: {
        model: "claude-sonnet-5",
        content: [],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: 3 },
        },
      },
    });
    await wDirect(homeCache, "session-cache-buckets", "agent-6", [line]);
    expect(getTel("agent-6", homeCache, "session-cache-buckets")?.tokenExtras).toEqual({
      cache_creation_ephemeral_5m_input_tokens: 7,
      cache_creation_ephemeral_1h_input_tokens: 3,
    });

    const homeBadRun = mktemp(import.meta.path, "session-bad-run");
    await wDirect(homeBadRun, "session-bad-run", "agent-7", [
      aLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-sonnet-5" }),
    ]);
    const wfDir = join(
      homeBadRun,
      ".claude",
      "projects",
      "some-project",
      "session-bad-run",
      "workflows",
    );
    await mkdir(wfDir, { recursive: true });
    await writeFile(join(wfDir, "wf_bad.json"), "{ bad json");
    expect(getTel("agent-7", homeBadRun, "session-bad-run")?.runContext).toBeUndefined();
  });
});

describe("readAgentTranscriptTelemetry — a Workflow-tool subagent, with its run aggregate", () => {
  test("the run aggregate defaultModel and totals ride along as run context", async () => {
    const home = mktemp(import.meta.path, "session-e");
    const runDir = join(
      home,
      ".claude",
      "projects",
      "some-project",
      "session-e",
      "subagents",
      "workflows",
      "wf_test1",
    );
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "agent-agent-4.jsonl"),
      aLine({
        timestamp: "2026-08-20T11:00:00.000Z",
        model: "claude-sonnet-5",
        inputTokens: 10,
        outputTokens: 5,
      }) + "\n",
    );
    await writeFile(
      join(runDir, "agent-agent-4.meta.json"),
      JSON.stringify({ agentType: "workflow-subagent", spawnDepth: 1 }),
    );

    const wfDir = join(home, ".claude", "projects", "some-project", "session-e", "workflows");
    await mkdir(wfDir, { recursive: true });
    await writeFile(
      join(wfDir, "wf_test1.json"),
      JSON.stringify({
        runId: "wf_test1",
        defaultModel: "claude-opus-5[1m]",
        totalTokens: 999,
        totalToolCalls: 42,
        status: "completed",
        workflowProgress: [
          { type: "workflow_agent", agentId: "agent-4", model: "claude-sonnet-5", state: "done" },
        ],
      }),
    );

    const result = getTel("agent-4", home, "session-e");
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
