import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  cleanupRoots,
  compiledCapsule,
  eventKinds,
  lastPayload,
  ledgerOf,
  registerCoordinator,
} from "../unit/agents/fixture.ts";
import {
  assistantLine,
  mktemp,
  toolResultLine,
  writeDirectTranscript,
} from "../unit/agents/transcript-fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

function worker(run: string) {
  return ledgerOf(run).find((grant) => grant.id === "worker-1")!;
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
        toolResultLine({
          timestamp: "2026-08-20T10:00:01.000Z",
          toolUseId: "toolu_a",
          isError: false,
        }),
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
          recorded_evidence_class: "agent_reported",
          probed_value: "claude-opus-5",
          probed_evidence_class: "harness_observed",
        },
      ]);
    });

    expect(worker(run).model).toEqual({
      value: "declared-model",
      evidence_class: "agent_reported",
    });
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
        probed_evidence_class: "harness_observed",
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
      await execute([
        "agent:release",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--reason",
        "transcript probe check done",
      ]);
    });

    expect(worker(run).status).toBe("released");
    expect(worker(run).tokens_in).toEqual({ value: 5, evidence_class: "harness_observed" });
  });
});
