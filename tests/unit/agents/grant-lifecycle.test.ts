import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { releaseAgentGrant } from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/grants.ts";
import {
  cleanupRoots,
  compiledCapsule,
  eventKinds,
  ledgerOf,
  registerCoordinator,
} from "./fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

async function registerWorker(run: string, extra: readonly string[] = []): Promise<void> {
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
    ...extra,
  ]);
}

describe("agent grant lifecycle", () => {
  test("mints, reports against and closes a grant", async () => {
    const run = await compiledCapsule(roots, "grant-lifecycle");
    await registerCoordinator(run);
    await registerWorker(run, [
      "--model",
      "opus-5",
      "--model-tier",
      "l",
      "--thinking-level",
      "high",
      "--tool",
      "Read",
    ]);

    const reported = await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tool",
      "Read",
      "--tool",
      "Edit",
      "--tokens-in",
      "18000",
      "--tokens-out",
      "2400",
    ]);
    expect(String(reported.markdown)).toContain("Tokens In");

    await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tool",
      "Read",
      "--tool",
      "Bash",
    ]);

    const released = await execute([
      "agent:release",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--reason",
      "task-1 submitted",
    ]);
    expect(released.active_grants).toBe(1);

    const worker = ledgerOf(run).find((grant) => grant.id === "worker-1");
    expect(worker?.status).toBe("released");
    expect(worker?.release_reason).toBe("task-1 submitted");
    expect(worker?.report_count).toBe(2);
    expect(worker?.tools_used?.map((tool) => tool.name)).toEqual(["Read", "Edit", "Bash"]);
    // Tool names come over the CLI from the agent, so they may not claim the host's own authority.
    expect(worker?.tools_used?.map((tool) => tool.evidence_class)).toEqual([
      "agent_reported",
      "agent_reported",
      "agent_reported",
    ]);
    expect(worker?.tools_granted?.evidence_class).toBe("agent_reported");
    // Same rule as tools above: --tokens-in and --model-tier are unverified CLI input too, not a
    // host attestation, unless a derived/transcript probe actually corroborates them (B39 finding 1).
    expect(worker?.tokens_in).toEqual({ value: 18000, evidence_class: "agent_reported" });
    expect(worker?.model_tier).toEqual({ value: "l", evidence_class: "agent_reported" });
    expect(eventKinds(run).slice(-4)).toEqual([
      "agent-registered",
      "agent-reported",
      "agent-reported",
      "agent-released",
    ]);
  });

  test("leaves telemetry the host never supplied absent", async () => {
    const run = await compiledCapsule(roots, "grant-absent");
    await registerCoordinator(run);
    await registerWorker(run);

    const worker = ledgerOf(run).find((grant) => grant.id === "worker-1")!;
    for (const field of [
      "model",
      "model_tier",
      "thinking_level",
      "tools_granted",
      "tokens_in",
      "tokens_out",
    ]) {
      expect(field in worker).toBeFalse();
    }
    const listed = await execute(["agent:list", "--run", run]);
    expect(String(listed.markdown)).toContain("unknown");
  });

  test("records an explicitly unknown level as unknown evidence, not as a fact", async () => {
    const run = await compiledCapsule(roots, "grant-unknown");
    await registerCoordinator(run);
    await registerWorker(run, ["--thinking-level", "unknown", "--model-tier", "unknown"]);

    const worker = ledgerOf(run).find((grant) => grant.id === "worker-1")!;
    expect(worker.thinking_level).toEqual({ value: "unknown", evidence_class: "unknown" });
    expect(worker.model_tier).toEqual({ value: "unknown", evidence_class: "unknown" });
  });

  test("flags estimated token counts as derived estimates", async () => {
    const run = await compiledCapsule(roots, "grant-estimated");
    await registerCoordinator(run);
    await registerWorker(run);
    await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tokens-in",
      "12000",
      "--tokens-estimated",
    ]);

    const worker = ledgerOf(run).find((grant) => grant.id === "worker-1")!;
    expect(worker.tokens_in).toEqual({
      value: 12000,
      evidence_class: "derived",
      is_estimated: true,
    });
    expect("tokens_out" in worker).toBeFalse();
  });

  test("rejects a thinking level or role outside the vocabulary", async () => {
    const run = await compiledCapsule(roots, "grant-vocabulary");
    await registerCoordinator(run);
    await expect(registerWorker(run, ["--thinking-level", "ultra"])).rejects.toThrow(
      "--thinking-level must be one of",
    );
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-2",
        "--role",
        "helper",
        "--host",
        "claude-code",
      ]),
    ).rejects.toThrow("--role must be one of");
  });

  test("refuses grants that would invent a parent, a task or a duplicate", async () => {
    const run = await compiledCapsule(roots, "grant-refusals");
    await registerCoordinator(run);
    await expect(registerWorker(run, []).then(() => registerWorker(run, []))).rejects.toThrow(
      "already holds a grant",
    );
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-2",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "ghost-1",
      ]),
    ).rejects.toThrow("holds no grant");
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-3",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-task",
        "task-404",
      ]),
    ).rejects.toThrow("does not exist in this run");
  });

  test("refuses an empty report and any report after release", async () => {
    const run = await compiledCapsule(roots, "grant-report-refusals");
    await registerCoordinator(run);
    await registerWorker(run);
    await expect(execute(["agent:report", "--run", run, "--agent", "worker-1"])).rejects.toThrow(
      "at least one of --tool",
    );
    await execute([
      "agent:release",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--reason",
      "no evidence to report",
    ]);
    await expect(
      execute(["agent:report", "--run", run, "--agent", "worker-1", "--tool", "Read"]),
    ).rejects.toThrow("can no longer report");
    await expect(
      execute([
        "agent:release",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--reason",
        "released twice on purpose",
      ]),
    ).rejects.toThrow("already released");
  });
});

// B21: releasing a grant terminates or closes out an agent's participation — exactly the kind of
// transition B21.1 names outright — so the CLI never accepts it without a stated reason, and
// releaseAgentGrant refuses independently so no other caller can skip the requirement either.
describe("B21: agent:release refuses without a reason", () => {
  test("CLI: --reason is required", async () => {
    const run = await compiledCapsule(roots, "b21-release-cli-missing");
    await registerCoordinator(run);
    await registerWorker(run);
    await expect(
      execute(["agent:release", "--run", run, "--agent", "worker-1"]),
    ).rejects.toThrow("--reason is required");
  });

  test("CLI: a blank --reason is refused, not accepted as empty text", async () => {
    const run = await compiledCapsule(roots, "b21-release-cli-blank");
    await registerCoordinator(run);
    await registerWorker(run);
    await expect(
      execute(["agent:release", "--run", run, "--agent", "worker-1", "--reason", "   "]),
    ).rejects.toThrow("--reason must have a non-blank value");
  });

  test("domain: releaseAgentGrant refuses a blank reason before touching the ledger", () => {
    expect(() =>
      releaseAgentGrant({
        runRoot: "/nonexistent/run",
        agentId: "worker-1",
        actor: "worker-1",
        reason: "",
      }),
    ).toThrow("reason must be non-blank text");
  });
});
