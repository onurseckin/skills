import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { readAgentTranscriptTelemetry } from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/transcript-telemetry.ts";
import {
  cleanupRoots,
  compiledCapsule,
  eventKinds,
  lastPayload,
  ledgerOf,
  registerCoordinator,
} from "./fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

function worker(run: string) {
  return ledgerOf(run).find((grant) => grant.id === "worker-1")!;
}

/** One assistant turn carrying real usage and, optionally, a tool call. */
function assistantLine(opts: {
  timestamp: string;
  model?: string;
  effort?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  toolUseId?: string;
  toolName?: string;
}): string {
  const content: unknown[] = [];
  if (opts.toolUseId !== undefined) {
    content.push({ type: "tool_use", id: opts.toolUseId, name: opts.toolName, input: {} });
  }
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.timestamp,
    effort: opts.effort,
    message: {
      model: opts.model,
      content,
      usage: {
        input_tokens: opts.inputTokens ?? 0,
        output_tokens: opts.outputTokens ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  });
}

function toolResultLine(opts: {
  timestamp: string;
  toolUseId: string;
  isError?: boolean;
  toolUseResult?: string;
}): string {
  return JSON.stringify({
    type: "user",
    timestamp: opts.timestamp,
    message: {
      content: [
        { type: "tool_result", tool_use_id: opts.toolUseId, is_error: opts.isError ?? false },
      ],
    },
    ...(opts.toolUseResult === undefined ? {} : { toolUseResult: opts.toolUseResult }),
  });
}

async function writeDirectTranscript(
  homeDir: string,
  sessionId: string,
  agentId: string,
  lines: string[],
  meta?: Record<string, unknown>,
): Promise<void> {
  const dir = join(homeDir, ".claude", "projects", "some-project", sessionId, "subagents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `agent-${agentId}.jsonl`), lines.join("\n") + "\n");
  if (meta !== undefined) {
    await writeFile(join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
  }
}

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

async function mktemp(roots: string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "transcript-telemetry-"));
  roots.push(home);
  return home;
}

describe("the transcript probe wired into agent:register and agent:release, with no CLI edits", () => {
  async function withFakeHomeAndSession(
    home: string,
    sessionId: string,
    run: () => Promise<void>,
  ): Promise<void> {
    const previousHome = process.env.HOME;
    const previousSession = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.HOME = home;
    process.env.CLAUDE_CODE_SESSION_ID = sessionId;
    try {
      await run();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = previousSession;
    }
  }

  test("agent:register folds in real model, tokens and tool calls as harness_observed", async () => {
    const run = await compiledCapsule(roots, "transcript-cli-register");
    await registerCoordinator(run);
    const home = await mktemp(roots);
    await writeDirectTranscript(
      home,
      "session-register",
      "worker-1",
      [
        assistantLine({
          timestamp: "2026-08-20T10:00:00.000Z",
          model: "claude-sonnet-5",
          effort: "high",
          inputTokens: 200,
          outputTokens: 40,
          toolUseId: "toolu_a",
          toolName: "Read",
        }),
        toolResultLine({ timestamp: "2026-08-20T10:00:01.000Z", toolUseId: "toolu_a", isError: false }),
      ],
      { agentType: "general-purpose", spawnDepth: 1 },
    );

    await withFakeHomeAndSession(home, "session-register", async () => {
      await execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "coordinator-1",
        "--parent-task",
        "task-1",
      ]);
    });

    const grant = worker(run);
    expect(grant.model).toEqual({ value: "claude-sonnet-5", evidence_class: "harness_observed" });
    expect(grant.thinking_level).toEqual({ value: "high", evidence_class: "harness_observed" });
    expect(grant.tokens_in).toEqual({ value: 200, evidence_class: "harness_observed" });
    expect(grant.tokens_out).toEqual({ value: 40, evidence_class: "harness_observed" });
    expect(grant.tools_used).toEqual([
      {
        name: "Read",
        extras: { calls: 1, failures: 0 },
        evidence_class: "harness_observed",
        first_reported_at: expect.any(String),
      },
    ]);
    expect(lastPayload(run, "agent-registered").transcript_context).toMatchObject({
      agent_type: "general-purpose",
      spawn_depth: 1,
    });
  });

  test("an explicit --model that disagrees with the transcript is kept, and the disagreement is recorded", async () => {
    const run = await compiledCapsule(roots, "transcript-cli-conflict");
    await registerCoordinator(run);
    const home = await mktemp(roots);
    await writeDirectTranscript(home, "session-conflict", "worker-1", [
      assistantLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-opus-5" }),
    ]);

    await withFakeHomeAndSession(home, "session-conflict", async () => {
      const registered = await execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--model",
        "declared-model",
        "--parent-agent",
        "coordinator-1",
        "--parent-task",
        "task-1",
      ]);
      expect(registered.host_telemetry_conflicts).toEqual([
        {
          field: "model",
          recorded_value: "declared-model",
          recorded_evidence_class: "host_reported",
          probed_value: "claude-opus-5",
        },
      ]);
    });

    expect(worker(run).model).toEqual({ value: "declared-model", evidence_class: "host_reported" });
  });

  test("a mismatched declared parent is recorded as a conflict, never silently changed", async () => {
    const run = await compiledCapsule(roots, "transcript-cli-lineage");
    await registerCoordinator(run);
    await registerCoordinator(run, "coordinator-2");
    const home = await mktemp(roots);
    await writeDirectTranscript(
      home,
      "session-lineage",
      "worker-1",
      [assistantLine({ timestamp: "2026-08-20T10:00:00.000Z", model: "claude-sonnet-5" })],
      { parentAgentId: "coordinator-2", spawnDepth: 2 },
    );

    await withFakeHomeAndSession(home, "session-lineage", async () => {
      const registered = await execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "coordinator-1",
        "--parent-task",
        "task-1",
      ]);
      expect(registered.host_telemetry_conflicts).toContainEqual({
        field: "parent_agent_id",
        recorded_value: "coordinator-1",
        recorded_evidence_class: "agent_reported",
        probed_value: "coordinator-2",
      });
    });

    // The declared parent still governs the ledger; the transcript's disagreement is recorded beside
    // it, never used to silently rewrite lineage the coordinator itself asserted.
    expect(worker(run).parent_agent_id).toBe("coordinator-1");
  });

  test("task:claim re-probes and grows the token counts with zero edits to that command", async () => {
    const run = await compiledCapsule(roots, "transcript-cli-claim");
    await registerCoordinator(run);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-1",
    ]);
    expect(worker(run).tokens_in).toBeUndefined();

    const home = await mktemp(roots);
    await writeDirectTranscript(home, "session-claim", "worker-1", [
      assistantLine({
        timestamp: "2026-08-20T10:00:00.000Z",
        model: "claude-sonnet-5",
        inputTokens: 300,
        outputTokens: 60,
      }),
    ]);

    await withFakeHomeAndSession(home, "session-claim", async () => {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--role",
        "implementer",
      ]);
    });

    expect(worker(run).tokens_in).toEqual({ value: 300, evidence_class: "harness_observed" });
    expect(eventKinds(run)).toContain("agent-telemetry-probed");
  });

  test("agent:release folds the read in while the grant is still active", async () => {
    const run = await compiledCapsule(roots, "transcript-cli-release");
    await registerCoordinator(run);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-1",
    ]);
    const home = await mktemp(roots);
    await writeDirectTranscript(home, "session-release", "worker-1", [
      assistantLine({
        timestamp: "2026-08-20T10:00:00.000Z",
        model: "claude-sonnet-5",
        inputTokens: 5,
        outputTokens: 5,
      }),
    ]);

    await withFakeHomeAndSession(home, "session-release", async () => {
      await execute(["agent:release", "--run", run, "--agent", "worker-1"]);
    });

    expect(worker(run).status).toBe("released");
    expect(worker(run).tokens_in).toEqual({ value: 5, evidence_class: "harness_observed" });
  });
});
