import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { AutonomousLoopRunner } from "../../../olt/scripts/src/orchestrator/loop-runner.ts";
import {
  loopGateStatus,
  roundGateStatus,
} from "../../../olt/scripts/src/orchestrator/gate-status.ts";
import type {
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
  RoundTelemetry,
} from "../../../olt/scripts/src/orchestrator/types.ts";

const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();
const spies: { mockRestore: () => void }[] = [];
let rootCounter = 0;

const origExists = fs.existsSync.bind(fs);
const origRead = fs.readFileSync.bind(fs);
const isVirt = (s: string) => s.startsWith("/tmp/virtual-") || s.startsWith("/virtual/");

function telemetry(round: number, gateStatus: RoundTelemetry["gateStatus"]): RoundTelemetry {
  return {
    round,
    runId: `run-${round}`,
    status: "completed",
    startedAt: "2026-08-19T00:00:00.000Z",
    durationMs: 1,
    taskCount: 1,
    completedTaskCount: 1,
    openFindingsCount: 0,
    resolvedFindingsCount: 0,
    gateStatus,
    gateCount: gateStatus === "not_run" ? 0 : 1,
  };
}

function executorReturning(
  perRound: (round: number) => Partial<RoundExecutionResult>,
): RoundExecutor {
  return {
    async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
      return {
        runId: input.runId,
        round: input.round,
        status: "completed",
        criticDecision: "approve",
        tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
        findings: [],
        gateResults: [],
        summary: `Round ${input.round}`,
        ...perRound(input.round),
      };
    },
  };
}

function withTempRepo<T>(name: string, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = `/tmp/virtual-gate-honesty-${++rootCounter}-${name}`;
  mockDirs.add(dir);
  return body(dir);
}

describe("loop gate status honesty", () => {
  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (isVirt(s)) return mockFiles.has(s) || mockDirs.has(s);
        return origExists(p);
      }),
      spyOn(fs, "mkdirSync").mockImplementation(((
        p: fs.PathLike,
        opts?: fs.MakeDirectoryOptions | boolean,
      ) => {
        const s = String(p);
        mockDirs.add(s);
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (isVirt(s)) {
          const val = mockFiles.get(s);
          if (val !== undefined) return val;
          throw new Error(`ENOENT: no such file, open '${s}'`);
        }
        return origRead(p as never);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        data: string | NodeJS.ArrayBufferView,
      ) => {
        const s = String(p);
        mockFiles.set(
          s,
          typeof data === "string"
            ? data
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });
  it("classifies an empty gate result set as not_run, never as passed", () => {
    expect(roundGateStatus([])).toBe("not_run");
    expect(roundGateStatus([{ gate_id: "g", command_id: "c", status: "passed" }])).toBe("passed");
    expect(roundGateStatus([{ gate_id: "g", command_id: "c", status: "failed" }])).toBe("failed");
  });

  it("aggregates rounds without inventing a clean sweep", () => {
    expect(loopGateStatus([])).toBe("not_run");
    expect(loopGateStatus([telemetry(1, "not_run")])).toBe("not_run");
    expect(loopGateStatus([telemetry(1, "passed"), telemetry(2, "passed")])).toBe("passed");
    expect(loopGateStatus([telemetry(1, "passed"), telemetry(2, "not_run")])).toBe("partial");
    expect(loopGateStatus([telemetry(1, "failed"), telemetry(2, "passed")])).toBe("failed");
  });

  it("refuses to converge on a round that ran no gate at all", async () => {
    const summary = await withTempRepo("loop-no-gates", (dir) =>
      new AutonomousLoopRunner({
        baseRunId: "run-no-gates",
        repoPath: dir,
        initialPrompt: "Do the work",
        maxRounds: 1,
        executor: executorReturning(() => ({ gateResults: [] })),
      }).run(),
    );

    expect(summary.finalStatus).not.toBe("converged_success");
    expect(summary.finalStatus).toBe("max_rounds_reached");
    expect(summary.rounds[0]?.gateStatus).toBe("not_run");
    expect(summary.rounds[0]?.gateCount).toBe(0);
    expect(summary.gateStatus).toBe("not_run");
    expect(summary.finalMarkdownSummary).toContain("`not_run`");
    expect(summary.finalMarkdownSummary).toContain("no gate ran in any round");
    expect(summary.finalMarkdownSummary).not.toContain("All Gates Passed");
  });

  it("reports partial when only some rounds ran a gate", async () => {
    const summary = await withTempRepo("loop-partial-gates", (dir) =>
      new AutonomousLoopRunner({
        baseRunId: "run-partial-gates",
        repoPath: dir,
        initialPrompt: "Do the work",
        maxRounds: 2,
        executor: executorReturning((round) =>
          round === 1
            ? { gateResults: [] }
            : { gateResults: [{ gate_id: "gate-01", command_id: "cmd-2", status: "passed" }] },
        ),
      }).run(),
    );

    expect(summary.totalRoundsExecuted).toBe(2);
    expect(summary.finalStatus).toBe("converged_success");
    expect(summary.gateStatus).toBe("partial");
    expect(summary.finalMarkdownSummary).toContain("some rounds ran no gate");
  });
});
