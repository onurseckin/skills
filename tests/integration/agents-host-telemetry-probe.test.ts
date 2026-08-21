import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  refreshAgentDerivedTelemetry,
  registerAgentGrant,
  releaseAgentGrant,
} from "../../orchestrating-long-tasks/scripts/src/workflow/agents/grants.ts";
import {
  cleanupRoots,
  compiledCapsule,
  eventKinds,
  lastPayload,
  ledgerOf,
  registerCoordinator,
} from "../unit/agents/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

function worker(run: string) {
  return ledgerOf(run).find((grant) => grant.id === "worker-1")!;
}

function registerWorker(run: string) {
  return registerAgentGrant({
    runRoot: run,
    agentId: "worker-1",
    role: "implementer",
    parentAgentId: "coordinator-1",
    parentTaskId: "task-1",
    host: "some-host",
    actor: "coordinator-1",
    maxAgents: 20,
    telemetry: {},
  });
}

describe("registerAgentGrant merges the CLI's explicit report with a derived probe", () => {
  test("a derived value fills a field the flags left absent, marked derived", async () => {
    const run = await compiledCapsule(roots, "derived-fill");
    await registerCoordinator(run);
    const outcome = registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      actor: "coordinator-1",
      maxAgents: 20,
      telemetry: {},
      derivedTelemetry: { model: "derived-model", contextWindow: 128000 },
    });
    expect(outcome.grant.model).toEqual({ value: "derived-model", evidence_class: "derived" });
    expect(outcome.grant.context_window).toEqual({ value: 128000, evidence_class: "derived" });
    expect(outcome.conflicts).toBeUndefined();
  });

  test("an explicit report keeps the ledger field, and the probe's disagreement is recorded, not dropped", async () => {
    const run = await compiledCapsule(roots, "derived-conflict");
    await registerCoordinator(run);
    const outcome = registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      actor: "coordinator-1",
      maxAgents: 20,
      telemetry: { model: "explicit-model" },
      derivedTelemetry: { model: "derived-model" },
    });
    expect(outcome.grant.model).toEqual({
      value: "explicit-model",
      evidence_class: "agent_reported",
    });
    expect(outcome.conflicts).toEqual([
      {
        field: "model",
        recorded_value: "explicit-model",
        recorded_evidence_class: "agent_reported",
        probed_value: "derived-model",
        probed_evidence_class: "derived",
      },
    ]);
  });

  test("agreement between the two sources is not flagged as a conflict", async () => {
    const run = await compiledCapsule(roots, "derived-agree");
    await registerCoordinator(run);
    const outcome = registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      actor: "coordinator-1",
      maxAgents: 20,
      telemetry: { model: "same-model" },
      derivedTelemetry: { model: "same-model" },
    });
    expect(outcome.grant.model).toEqual({ value: "same-model", evidence_class: "agent_reported" });
    expect(outcome.conflicts).toBeUndefined();
  });
});

describe("refreshAgentDerivedTelemetry — the probe at task:claim, task:submit and agent:release", () => {
  test("fills a field the register call left empty", async () => {
    const run = await compiledCapsule(roots, "refresh-fill");
    await registerCoordinator(run);
    registerWorker(run);

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "worker-1",
      actor: "worker-1",
      boundary: "task:claim",
      derived: { contextWindow: 200000 },
    });
    expect(outcome?.grant.context_window).toEqual({ value: 200000, evidence_class: "derived" });
    expect(eventKinds(run).at(-1)).toBe("agent-telemetry-probed");
  });

  test("a later probe that disagrees with an already-recorded field keeps the recorded value", async () => {
    const run = await compiledCapsule(roots, "refresh-conflict");
    await registerCoordinator(run);
    registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      actor: "coordinator-1",
      maxAgents: 20,
      telemetry: { model: "original-model" },
    });

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "worker-1",
      actor: "worker-1",
      boundary: "task:submit",
      derived: { model: "different-model" },
    });
    expect(outcome?.grant.model?.value).toBe("original-model");
    expect(outcome?.conflicts).toEqual([
      {
        field: "model",
        recorded_value: "original-model",
        recorded_evidence_class: "agent_reported",
        probed_value: "different-model",
        probed_evidence_class: "derived",
      },
    ]);
  });

  test("an agent that never registered has nothing to attach a probe to", async () => {
    const run = await compiledCapsule(roots, "refresh-unregistered");
    await registerCoordinator(run);
    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "ghost-agent",
      actor: "ghost-agent",
      boundary: "task:claim",
      derived: { model: "x" },
    });
    expect(outcome).toBeNull();
  });

  test("a released grant no longer accepts a probe", async () => {
    const run = await compiledCapsule(roots, "refresh-released");
    await registerCoordinator(run);
    registerWorker(run);
    releaseAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      actor: "worker-1",
      reason: "probe-after-release check",
    });

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "worker-1",
      actor: "worker-1",
      boundary: "agent:release",
      derived: { model: "x" },
    });
    expect(outcome).toBeNull();
  });

  test("writes no event when the probe finds nothing new and nothing conflicting", async () => {
    const run = await compiledCapsule(roots, "refresh-quiet");
    await registerCoordinator(run);
    registerAgentGrant({
      runRoot: run,
      agentId: "worker-1",
      role: "implementer",
      parentAgentId: "coordinator-1",
      parentTaskId: "task-1",
      host: "some-host",
      actor: "coordinator-1",
      maxAgents: 20,
      telemetry: { model: "steady-model" },
    });
    const before = eventKinds(run).length;

    const outcome = refreshAgentDerivedTelemetry({
      runRoot: run,
      agentId: "worker-1",
      actor: "worker-1",
      boundary: "task:claim",
      derived: { model: "steady-model" },
    });
    expect(outcome).toBeNull();
    expect(eventKinds(run).length).toBe(before);
  });
});

describe("the probe wired into the CLI boundaries themselves, never a separate command", () => {
  // The variables that identify a host on their own. They are cleared alongside HOME so the fake
  // home below is the ONLY evidence in play; a machine that exports one of these would otherwise
  // identify a different host and the assertions would be measuring the developer's laptop.
  const IDENTIFYING_VARS = [
    "CLAUDE_CODE_MODEL",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_SESSION_ID",
    "CURSOR_MODEL",
    "MODEL",
    "AI_MODEL",
    "GEMINI_MODEL",
    "ANTIGRAVITY_MODEL",
  ];

  async function withFakeHome(home: string, run: () => Promise<void>): Promise<void> {
    const previous = process.env.HOME;
    const previousVars = IDENTIFYING_VARS.map((name): [string, string | undefined] => [
      name,
      process.env[name],
    ]);
    process.env.HOME = home;
    for (const name of IDENTIFYING_VARS) delete process.env[name];
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
      for (const [name, value] of previousVars) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  async function codexHome(name: string, config: string): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), name));
    roots.push(home);
    await mkdir(join(home, ".codex", "agents"), { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), config);
    return home;
  }

  test("agent:register records what the host CAN do, and which host that was read from", async () => {
    const run = await compiledCapsule(roots, "cli-wiring-capabilities");
    await registerCoordinator(run);
    const home = await codexHome(
      "telemetry-cli-home-caps-",
      "[agents]\nmax_concurrent_threads_per_session = 6\n\n[features]\nmulti_agent = true\n",
    );

    await withFakeHome(home, async () => {
      await execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "codex",
        "--parent-agent",
        "coordinator-1",
        "--parent-task",
        "task-1",
      ]);
    });

    const payload = lastPayload(run, "agent-registered");
    expect(payload.host_capabilities_source).toBe("codex");
    expect(payload.host_capabilities).toEqual({
      concurrency_ceiling: { value: 6, evidence_class: "derived" },
      multi_agent_enabled: { value: true, evidence_class: "derived" },
      native_resume: { value: true, evidence_class: "derived" },
      per_agent_model_selection: { value: true, evidence_class: "derived" },
    });
  });

  test("a flag and the host's own config disagreeing is kept on both the event and the result", async () => {
    const run = await compiledCapsule(roots, "cli-wiring-conflict");
    await registerCoordinator(run);
    const home = await codexHome(
      "telemetry-cli-home-conflict-",
      "[features]\nmulti_agent = true\n",
    );
    await writeFile(join(home, ".codex", "agents", "worker-1.toml"), 'model = "codex-mini"\n');

    await withFakeHome(home, async () => {
      const registered = await execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "codex",
        "--model",
        "relayed-model",
        "--parent-agent",
        "coordinator-1",
        "--parent-task",
        "task-1",
      ]);
      expect(registered.host_telemetry_conflicts).toEqual([
        {
          field: "model",
          recorded_value: "relayed-model",
          recorded_evidence_class: "agent_reported",
          probed_value: "codex-mini",
          probed_evidence_class: "derived",
        },
      ]);
    });

    // The dispatcher's relay keeps the ledger field; the probe's disagreement survives beside it.
    expect(worker(run).model).toEqual({ value: "relayed-model", evidence_class: "agent_reported" });
    expect(lastPayload(run, "agent-registered").telemetry_conflicts).toEqual([
      {
        field: "model",
        recorded_value: "relayed-model",
        recorded_evidence_class: "agent_reported",
        probed_value: "codex-mini",
        probed_evidence_class: "derived",
      },
    ]);
  });

  test("task:claim reads the host's own config for the claiming agent automatically", async () => {
    const run = await compiledCapsule(roots, "cli-wiring-claim");
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
      "codex",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-1",
    ]);
    expect(worker(run).model).toBeUndefined();

    const fakeHome = await mkdtemp(join(tmpdir(), "telemetry-cli-home-"));
    roots.push(fakeHome);
    await mkdir(join(fakeHome, ".codex", "agents"), { recursive: true });
    await writeFile(
      join(fakeHome, ".codex", "config.toml"),
      "[agents]\nmax_concurrent_threads_per_session = 6\n",
    );
    await writeFile(join(fakeHome, ".codex", "agents", "worker-1.toml"), 'model = "codex-mini"\n');

    await withFakeHome(fakeHome, async () => {
      const claim = await execute([
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
      // No `agent:report` round-trip happened — the CLI call above is the only thing that ran.
      expect(claim.host_telemetry_conflicts).toBeUndefined();
    });

    expect(worker(run).model).toEqual({ value: "codex-mini", evidence_class: "derived" });
    expect(eventKinds(run)).toContain("agent-telemetry-probed");
  });

  test("agent:release folds the probe in while the grant is still active", async () => {
    const run = await compiledCapsule(roots, "cli-wiring-release");
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
      "codex",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-1",
    ]);
    const home = await codexHome("telemetry-cli-home-release-", "[features]\nmulti_agent = true\n");
    await writeFile(join(home, ".codex", "agents", "worker-1.toml"), 'model = "codex-mini"\n');

    await withFakeHome(home, async () => {
      await execute([
        "agent:release",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--reason",
        "host telemetry probe check done",
      ]);
    });

    // Released grants refuse telemetry, so the ordering inside the command is what makes this land.
    expect(worker(run).status).toBe("released");
    expect(worker(run).model).toEqual({ value: "codex-mini", evidence_class: "derived" });
  });

  test("a different agent id on the same host sees no per-agent file at all", async () => {
    const run = await compiledCapsule(roots, "cli-wiring-agent-id");
    await registerCoordinator(run);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-2",
      "--role",
      "implementer",
      "--host",
      "codex",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-2",
    ]);

    const fakeHome = await mkdtemp(join(tmpdir(), "telemetry-cli-home-other-"));
    roots.push(fakeHome);
    await mkdir(join(fakeHome, ".codex", "agents"), { recursive: true });
    await writeFile(join(fakeHome, ".codex", "config.toml"), "[features]\nmulti_agent = true\n");
    // Only worker-1 has a per-agent file; worker-2 claims below and must not pick it up.
    await writeFile(join(fakeHome, ".codex", "agents", "worker-1.toml"), 'model = "codex-mini"\n');

    await withFakeHome(fakeHome, async () => {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "task-2",
        "--agent",
        "worker-2",
        "--role",
        "implementer",
      ]);
    });

    expect(ledgerOf(run).find((grant) => grant.id === "worker-2")?.model).toBeUndefined();
  });
});
