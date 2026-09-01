import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatMindPulseOpenBrief,
  mindPulseOpenCommand,
} from "../../../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import type { AgentRole } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes } from "../../../../../olt/scripts/src/core/json.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import type {
  VirtualMemoryFS,
  ReadFileOptions,
} from "../../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
beforeEach(() => setupVirtualCliFS());
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function grantRole(run: string, agentId: string, role: AgentRole): void {
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

async function setupValidCharter(repo: string, run: string): Promise<string> {
  const charterRel = "olt/agents/mind.yaml";
  const charterPath = join(repo, charterRel);
  await mkdir(join(repo, "olt/agents"), { recursive: true });
  const content = "version: 1\ngoals:\n  - G1\n";
  await writeFile(charterPath, content);
  const sha = createHash("sha256").update(content).digest("hex");
  transact(run, "coordinator", "set-charter", {}, (draft) => {
    draft.mind = { charter: { source_path: charterRel, pinned_sha256: sha, repo_roots: [repo] } };
  });
  return sha;
}

describe("mind-pulse-open", () => {
  test("formatMindPulseOpenBrief handles numeric and unlimited daily limits", () => {
    const briefInf = formatMindPulseOpenBrief({
      pulseId: "pulse-1",
      runRoot: "/virtual/run",
      actor: "mind",
      host: "local",
      driver: "claude",
      openedAt: "2026-09-01T12:00:00.000Z",
      deadlineAt: "2026-09-01T13:00:00.000Z",
      pulsesToday: 1,
      pulsesPerDay: null,
    });
    expect(briefInf).toContain("1 / ∞ pulses today");

    const briefNum = formatMindPulseOpenBrief({
      pulseId: "pulse-2",
      runRoot: "/virtual/run",
      actor: "mind",
      host: "local",
      driver: "claude",
      openedAt: "2026-09-01T12:00:00.000Z",
      deadlineAt: "2026-09-01T13:00:00.000Z",
      pulsesToday: 3,
      pulsesPerDay: 10,
    });
    expect(briefNum).toContain("3 / 10 pulses today");
  });

  test("enforces agent grant requirements, valid roles, and mind halt states", async () => {
    const { repo, run } = await setupCompiledRun("mind-pulse-open-roles", roots);
    await setupValidCharter(repo, run);

    expect(() =>
      mindPulseOpenCommand({ run, actor: "unregistered-agent", host: "local", driver: "claude" }),
    ).toThrow("holds no grant");

    grantRole(run, "impl-agent", "implementer");
    expect(() =>
      mindPulseOpenCommand({ run, actor: "impl-agent", host: "local", driver: "claude" }),
    ).toThrow("role 'mind' is required");

    transact(run, "coordinator", "halt-mind", {}, (draft) => {
      draft.mind = {
        ...(draft.mind as Record<string, unknown>),
        halted: true,
        halt_reason: "Cap reached",
      };
    });
    expect(() =>
      mindPulseOpenCommand({ run, actor: "planner", host: "local", driver: "claude" }),
    ).toThrow("mind is halted (Cap reached)");

    transact(run, "coordinator", "halt-mind-no-reason", {}, (draft) => {
      draft.mind = {
        ...(draft.mind as Record<string, unknown>),
        halted: true,
        halt_reason: undefined,
      };
    });
    expect(() =>
      mindPulseOpenCommand({ run, actor: "planner", host: "local", driver: "claude" }),
    ).toThrow("mind is halted (unknown reason)");
  });

  test("enforces open pulse conflict rules for active and expired pulses", async () => {
    const { repo, run } = await setupCompiledRun("mind-pulse-open-conflicts", roots);
    await setupValidCharter(repo, run);

    transact(run, "coordinator", "open-pulse-active", {}, (draft) => {
      draft.pulse = { open: { pulse_id: "pulse-active", deadline_at: "2026-09-01T14:00:00.000Z" } };
    });

    expect(() =>
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "local",
        driver: "claude",
        now: "2026-09-01T13:00:00.000Z",
      }),
    ).toThrow("pulse pulse-active is already open");

    expect(() =>
      mindPulseOpenCommand({
        run,
        actor: "mind-1",
        host: "local",
        driver: "claude",
        now: "2026-09-01T15:00:00.000Z",
      }),
    ).toThrow("past its deadline");
  });

  test("validates charter existence, sha drift, read exceptions, event sequence and daily budgets", async () => {
    const { repo, run } = await setupCompiledRun("mind-pulse-open-invariants", roots);

    expect(() =>
      mindPulseOpenCommand({ run, actor: "mind", host: "local", driver: "claude" }),
    ).toThrow("charter file at 'olt/agents/mind.yaml' is missing");

    await setupValidCharter(repo, run);
    transact(run, "coordinator", "corrupt-sha", {}, (draft) => {
      const m = draft.mind as Record<string, unknown>;
      const c = m.charter as Record<string, unknown>;
      c.pinned_sha256 = "invalid-sha-drift";
    });
    expect(() =>
      mindPulseOpenCommand({ run, actor: "mind", host: "local", driver: "claude" }),
    ).toThrow("charter sha256 mismatch");

    await setupValidCharter(repo, run);
    const vfs = getVirtualCliFS();
    const origRead = vfs.readFileSync;
    const readSpy = spyOn(vfs, "readFileSync").mockImplementation(function (
      this: VirtualMemoryFS,
      p: string,
      opts?: ReadFileOptions,
    ) {
      if (typeof p === "string" && p.includes("mind.yaml")) {
        throw new Error("Disk I/O failure");
      }
      return origRead.call(this, p, opts as never);
    } as never);

    expect(() =>
      mindPulseOpenCommand({ run, actor: "mind", host: "local", driver: "claude" }),
    ).toThrow("cannot read charter");
    readSpy.mockRestore();

    const statePath = join(run, "state.json");
    const rawState = JSON.parse(await readFile(statePath, "utf-8")) as Record<string, unknown>;
    rawState.event_sequence = 100_000;
    await writeFile(statePath, canonicalJsonBytes(rawState as never));

    expect(() =>
      mindPulseOpenCommand({ run, actor: "mind", host: "local", driver: "claude" }),
    ).toThrow("event headroom threshold reached");

    rawState.event_sequence = 10;
    rawState.budget = { pulses_per_day: 1, pulses_today: 1, day_key: "2026-09-01" };
    await writeFile(statePath, canonicalJsonBytes(rawState as never));

    expect(() =>
      mindPulseOpenCommand({
        run,
        actor: "mind",
        host: "local",
        driver: "claude",
        now: "2026-09-01T12:00:00.000Z",
      }),
    ).toThrow("daily pulse budget exhausted");
  });

  test("successfully opens pulse, writes auto-grant, advances pulse counter and writes last pulse", async () => {
    const { repo, run } = await setupCompiledRun("mind-pulse-open-success", roots);
    await setupValidCharter(repo, run);

    transact(run, "coordinator", "set-custom-budget", {}, (draft) => {
      draft.budget = {
        pulse_deadline_ms: 60_000,
        pulses_per_day: 10,
        wall_clock_ms_per_day: 3_600_000,
      };
    });

    const result = mindPulseOpenCommand({
      run,
      actor: "test-actor",
      host: "virtual-node",
      driver: "claude-sonnet",
      now: "2026-09-01T12:00:00.000Z",
    });

    expect(result.pulse_id).toBe("pulse-1");
    expect(result.actor).toBe("test-actor");
    expect(result.host).toBe("virtual-node");
    expect(result.driver).toBe("claude-sonnet");
    expect(result.opened_at).toBe("2026-09-01T12:00:00.000Z");
    expect(result.deadline_at).toBe("2026-09-01T12:01:00.000Z");
    expect(result.budget).toEqual({
      pulses_today: 1,
      pulses_per_day: 10,
      wall_clock_ms_today: 0,
      wall_clock_ms_per_day: 3_600_000,
    });
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown).toContain("Mind Pulse Opened: pulse-1");
  });
});
