import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
  mindPulseCommand,
} from "../../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import * as durableWriteModule from "../../../../olt/scripts/src/core/durable-write.ts";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

const origExists = fs.existsSync;
const origRead = fs.readFileSync;

describe("cli/commands/mind-pulse smart-task integration (in-memory virtual)", () => {
  const repo = `${process.cwd()}/.olt/virtual-mind-pulse-repo`;
  const run = `${repo}/.olt/capsules/mind-gen-cmd-test`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let inMemoryState: RunState;

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(repo);
    mockDirs.add(run);
    mockDirs.add(join(repo, ".olt"));
    mockDirs.add(join(repo, ".olt", "capsules"));
    mockDirs.add(join(repo, "olt", "agents"));

    const charterContent = `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test Mind"\n  goals:\n    - id: "G1"\n      statement: "Goal 1"\n  non_goals:\n    - "Self-termination"\n  repo_roots:\n    - "src/"\n`;
    const charterSha = createHash("sha256").update(charterContent).digest("hex");
    mockFiles.set(join(repo, "olt", "agents", "mind.yaml"), charterContent);
    mockFiles.set(join(run, "events.jsonl"), "");

    inMemoryState = {
      version: "2.0.0",
      run_id: "mind-gen-cmd-test",
      status: "active",
      created_at: "2026-08-29T10:00:00.000Z",
      updated_at: "2026-08-29T10:00:00.000Z",
      tasks: {},
      agents: [],
      candidates: [],
      requirements: [],
      mind: {
        generation: 1,
        opened_at: "2026-08-29T10:00:00.000Z",
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      },
    } as unknown as RunState;

    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (mockFiles.has(s) || mockDirs.has(s)) return true;
        try {
          return origExists(p);
        } catch {
          return false;
        }
      }),
    );

    spies.push(
      spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        return origRead(p as string, "utf-8");
      }),
    );

    spies.push(
      spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
        mockFiles.set(
          String(p),
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      }),
    );

    spies.push(
      spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (mockFiles.has(s))
          return { isFile: () => true, isDirectory: () => false } as unknown as fs.Stats;
        return { isFile: () => false, isDirectory: () => true } as unknown as fs.Stats;
      }),
    );

    spies.push(
      spyOn(fs, "mkdirSync").mockImplementation((p) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }),
    );

    spies.push(
      spyOn(durableWriteModule, "atomicWriteBytes").mockImplementation((targetPath, bytes) => {
        mockFiles.set(targetPath, new TextDecoder().decode(bytes));
      }),
    );
    spies.push(
      spyOn(storeModule, "loadRun").mockImplementation(
        () =>
          ({
            state: inMemoryState,
            manifest: { version: "2.0.0", run_id: "mind-gen-cmd-test" },
            events: [],
          }) as unknown as ReturnType<typeof storeModule.loadRun>,
      ),
    );
    spies.push(
      spyOn(storeModule, "transact").mockImplementation((...args: unknown[]) => {
        const mutator = args.find((a) => typeof a === "function") as
          | ((s: RunState) => unknown)
          | undefined;
        if (mutator) mutator(inMemoryState);
        return inMemoryState;
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("exports canonical CLOSING_FORBIDDEN_FOR_MIND invariant constant", () => {
    expect(CLOSING_FORBIDDEN_FOR_MIND).toBe("CLOSING_FORBIDDEN_FOR_MIND");
  });

  it("formats pulse directive with Mode A proposals when active runs and backlog are zero", () => {
    const output = formatPulseDirective({ activeRuns: 0, pendingBacklog: 0 });
    expect(output).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
    expect(output).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    expect(output).toContain("Discovery Proposals:");
  });

  it("formats empty directive when active runs or pending backlog exist", () => {
    expect(formatPulseDirective({ activeRuns: 1, pendingBacklog: 0 })).toBe("");
    expect(formatPulseDirective({ activeRuns: 0, pendingBacklog: 2 })).toBe("");
    expect(formatPulseDirective({ activeRuns: 3, pendingBacklog: 5 })).toBe("");
  });

  it("computes cognitive telemetry from planning buffer and compiled tasks", () => {
    const stateEmpty: Record<string, unknown> = {};
    const telemetryEmpty = computeMindCognitiveTelemetry(stateEmpty);
    expect(telemetryEmpty.workSpan.total_work).toBe(0);
    expect(telemetryEmpty.activeAgents).toHaveLength(0);
    expect(telemetryEmpty.waveLanes).toHaveLength(0);

    const stateWithBuffer: Record<string, unknown> = {
      planning_buffer: [
        { id: "task-1", deps: [], effort: 2 },
        { id: "task-2", deps: ["task-1"], effort: 3 },
      ],
      agents: [
        {
          id: "agent-1",
          role: "implementer",
          host: "antigravity",
          status: "active",
          parent_task_id: "task-1",
        },
      ],
    };
    const telemetryBuffer = computeMindCognitiveTelemetry(stateWithBuffer);
    expect(telemetryBuffer.workSpan.total_work).toBe(5);
    expect(telemetryBuffer.workSpan.span).toBe(2);
    expect(telemetryBuffer.activeAgents).toHaveLength(1);
    expect(telemetryBuffer.activeAgents[0]?.agent_id).toBe("agent-1");
  });

  it("formats active and opened briefs adhering to format invariants", () => {
    const activeBrief = formatMindPulseActiveBrief({
      pulseId: "pulse-1",
      runRoot: "/test/run",
      actor: "mind-1",
      host: "antigravity",
      driver: "loop",
      openedAt: "2026-08-29T10:00:00.000Z",
      deadlineAt: "2026-08-29T10:20:00.000Z",
      scheduledIntervalMs: 900000,
      nextWakeAt: "2026-08-29T10:15:00.000Z",
      pulsesToday: 1,
      pulsesPerDay: 96,
      activeRuns: 0,
      pendingBacklog: 0,
    });
    expect(activeBrief).toContain("Mind Pulse Active: pulse-1");
    expect(activeBrief).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    expect(activeBrief).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");

    const openedBrief = formatMindPulseOpenedBrief({
      pulseId: "pulse-2",
      runRoot: "/test/run",
      actor: "mind-1",
      host: "antigravity",
      driver: "loop",
      openedAt: "2026-08-29T10:00:00.000Z",
      deadlineAt: "2026-08-29T10:20:00.000Z",
      scheduledIntervalMs: 900000,
      nextWakeAt: "2026-08-29T10:15:00.000Z",
      pulsesToday: 2,
      pulsesPerDay: 96,
      activeRuns: 1,
      pendingBacklog: 0,
    });
    expect(openedBrief).toContain("Mind Pulse Opened: pulse-2");
    expect(openedBrief).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    expect(openedBrief).not.toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
  });

  it("executes mindPulseCommand for opening and active telemetry cycles", async () => {
    const openTime = "2026-08-29T10:00:00.000Z";
    const checkTime = "2026-08-29T10:05:00.000Z";

    const openedResult = await mindPulseCommand({
      run,
      actor: "mind-1",
      host: "antigravity",
      driver: "perpetual-loop",
      now: openTime,
    });

    expect(openedResult.status).toBe("opened");
    expect(openedResult.action).toBe("opened");
    expect(openedResult.pulse_id).toBe("pulse-1");
    expect(openedResult.closing_permitted).toBe(false);
    expect(openedResult.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);

    const activeResult = await mindPulseCommand({
      run,
      actor: "mind-1",
      now: checkTime,
    });

    expect(activeResult.status).toBe("active");
    expect(activeResult.action).toBe("telemetry");
    expect(activeResult.pulse_id).toBe("pulse-1");
    expect(activeResult.closing_permitted).toBe(false);
    expect(activeResult.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);
  });
});
