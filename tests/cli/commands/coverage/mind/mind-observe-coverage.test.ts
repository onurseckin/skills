import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  formatMindObserveBrief,
  mindObserveCommand,
  type MindObserveResult,
} from "../../../../../olt/scripts/src/cli/commands/mind-observe.ts";
import { loadRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

function grantAgentRole(run: string, agentId: string, role: string): void {
  transact(run, "coordinator", `grant-${agentId}`, {}, (draft) => {
    const agents = Array.isArray(draft.agents) ? [...draft.agents] : [];
    agents.push({
      id: agentId,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: new Date().toISOString(),
      status: "active",
    });
    draft.agents = agents;
  });
}

describe("mind:observe Unit & Coverage Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(async () => {
    await cleanupRoots(roots);
    cleanupVirtualCliFS();
  });

  test("formatMindObserveBrief renders structured markdown with all metadata", () => {
    const brief = formatMindObserveBrief({
      observationId: "obs-1",
      runRoot: "/virtual/runs/test-run",
      actor: "mind-prime",
      sourceId: "intent-drift",
      sourceNumber: 1,
      sourceName: "code no longer matching intent",
      commandId: "C-101",
      count: 3,
      evidenceClass: "harness_observed",
      observedAt: "2026-09-01T12:00:00.000Z",
    });

    expect(brief).toContain("### Mind Source Observed: intent-drift (obs-1)");
    expect(brief).toContain("- **Capsule Root**: `/virtual/runs/test-run`");
    expect(brief).toContain("- **Actor**: `mind-prime`");
    expect(brief).toContain("- **Source**: `intent-drift` (#1 — code no longer matching intent)");
    expect(brief).toContain("- **Command ID**: `C-101`");
    expect(brief).toContain("- **Count**: 3");
    expect(brief).toContain("- **Evidence Class**: `harness_observed`");
    expect(brief).toContain("- **Observed At**: `2026-09-01T12:00:00.000Z`");
  });

  test("mindObserveCommand validates required flags, aliases, numbers, and sources", async () => {
    const { run } = await setupCompiledRun("observe-val", roots);
    grantAgentRole(run, "mind-agent", "mind");

    expect(() =>
      mindObserveCommand({
        actor: "mind-agent",
        source: "intent-drift",
        "command-id": "C-1",
        count: 1,
      }),
    ).toThrow();
    expect(() =>
      mindObserveCommand({ run, source: "intent-drift", "command-id": "C-1", count: 1 }),
    ).toThrow();
    expect(() =>
      mindObserveCommand({ run, actor: "mind-agent", "command-id": "C-1", count: 1 }),
    ).toThrow();

    expect(() =>
      mindObserveCommand({ run, actor: "mind-agent", source: "intent-drift", count: 1 }),
    ).toThrow();
    expect(() =>
      mindObserveCommand({
        run,
        actor: "mind-agent",
        source: "intent-drift",
        "command-id": "   ",
        count: 1,
      }),
    ).toThrow();

    expect(() =>
      mindObserveCommand({
        run,
        actor: "mind-agent",
        source: "intent-drift",
        "command-id": "C-1",
        count: -1,
      }),
    ).toThrow("--count must be a bounded integer >= 0");
    expect(() =>
      mindObserveCommand({
        run,
        actor: "mind-agent",
        source: "intent-drift",
        "command-id": "C-1",
        count: 2.5,
      }),
    ).toThrow("--count must be a bounded integer >= 0");
    expect(() =>
      mindObserveCommand({ run, actor: "mind-agent", source: "intent-drift", "command-id": "C-1" }),
    ).toThrow();
    expect(() =>
      mindObserveCommand({
        run,
        actor: "mind-agent",
        source: "intent-drift",
        "command-id": "C-1",
        count: "invalid" as unknown as number,
      }),
    ).toThrow();

    expect(() =>
      mindObserveCommand({
        run,
        actor: "mind-agent",
        source: "non-existent-source",
        "command-id": "C-1",
        count: 1,
      }),
    ).toThrow("unknown discovery source 'non-existent-source'");

    expect(() =>
      mindObserveCommand({
        run,
        actor: "mind-agent",
        source: "intent-drift",
        "command-id": "C-1",
        count: 1,
        now: "not-a-date",
      }),
    ).toThrow("invalid --now timestamp: not-a-date");
  });

  test("mindObserveCommand enforces agent role grants and rejects unverified commands", async () => {
    const { run } = await setupCompiledRun("observe-auth", roots);

    expect(() =>
      mindObserveCommand({
        run,
        actor: "ghost-agent",
        source: "intent-drift",
        "command-id": "C-1",
        count: 0,
      }),
    ).toThrow("agent ghost-agent holds no grant");

    grantAgentRole(run, "coord-agent", "coordinator");
    expect(() =>
      mindObserveCommand({
        run,
        actor: "coord-agent",
        source: "intent-drift",
        "command-id": "C-1",
        count: 0,
      }),
    ).toThrow("holds role 'coordinator'; role 'mind' is required for mind:observe");

    grantAgentRole(run, "mind-agent", "mind");
    expect(() =>
      mindObserveCommand({
        run,
        actor: "mind-agent",
        source: "intent-drift",
        "command-id": "C-missing",
        count: 0,
      }),
    ).toThrow("command id 'C-missing' was not found in any capsule");
  });

  test("mindObserveCommand successfully records observation, handles IDs, and returns result", async () => {
    const { run } = await setupCompiledRun("observe-exec", roots);
    grantAgentRole(run, "mind-agent", "mind");

    transact(run, "coordinator", "seed-commands", {}, (draft) => {
      draft.commands = {
        "C-cmd-rec-1": { id: "C-cmd-rec-1", exit_code: 0 },
        "C-cmd-rec-2": { id: "C-cmd-rec-2", exit_code: 0 },
        "C-cmd-rec-3": { id: "C-cmd-rec-3", exit_code: 0 },
      };
    });

    const res1 = mindObserveCommand({
      run,
      actor: "mind-agent",
      source: "intent-drift",
      "command-id": "C-cmd-rec-1",
      count: 0,
      now: "2026-09-01T10:00:00.000Z",
    });

    expect(res1.observation_id).toBe("obs-1");
    expect(res1.source).toBe("intent-drift");
    expect(res1.source_number).toBe(1);
    expect(res1.count).toBe(0);
    expect(res1.observed_at).toBe("2026-09-01T10:00:00.000Z");
    expect(res1.markdown).toContain("Mind Source Observed: intent-drift (obs-1)");

    const res2 = mindObserveCommand({
      run,
      actor: "mind-agent",
      source: "unused-code",
      command: "C-cmd-rec-2",
      count: 4,
    });

    expect(res2.observation_id).toBe("obs-2");
    expect(res2.source).toBe("unused-code");
    expect(res2.source_number).toBe(2);
    expect(res2.count).toBe(4);

    const res3 = mindObserveCommand({
      run,
      actor: "mind-agent",
      source: "failing-gates",
      cmd: "C-cmd-rec-3",
      count: "2" as unknown as number,
    });

    expect(res3.observation_id).toBe("obs-3");
    expect(res3.source).toBe("failing-gates");
    expect(res3.count).toBe(2);

    const loaded = loadRun(run, false);
    const observations = loaded.state.observations as Array<Record<string, unknown>>;
    expect(observations.length).toBe(3);
    expect(observations[0]?.id).toBe("obs-1");
    expect(observations[1]?.id).toBe("obs-2");
    expect(observations[2]?.id).toBe("obs-3");
  });

  test("mindObserveCommand handles non-standard existing observation IDs and policy init", async () => {
    const { run, repo } = await setupCompiledRun("observe-edge", roots);
    grantAgentRole(run, "mind-agent", "mind");

    transact(run, "coordinator", "seed-observations", {}, (draft) => {
      draft.commands = {
        "C-cmd-edge": { id: "C-cmd-edge", exit_code: 0 },
      };
      draft.observations = [
        { id: "custom-obs-name", count: 1 },
        { id: "obs-9", count: 2 },
      ];
    });

    const policyFile = join(repo, ".olt", "policy.json");
    if (existsSync(policyFile)) unlinkSync(policyFile);
    expect(existsSync(policyFile)).toBe(false);

    const res = mindObserveCommand({
      run,
      actor: "mind-agent",
      source: "charter-backlog",
      "command-id": "C-cmd-edge",
      count: 5,
    });

    expect(res.observation_id).toBe("obs-10");
    expect(res.source).toBe("charter-backlog");
    expect(res.count).toBe(5);
    expect(existsSync(policyFile)).toBe(true);
  });
});
