import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { orchestratorRunCommand } from "../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { AutonomousLoopRunner } from "../../../olt/scripts/src/orchestrator/loop-runner.ts";

describe("a loop with no round executor", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function temporaryRepo(name: string): string {
    const dir = `/tmp/virtual-exec-req-${++rootCounter}-${name}`;
    mockDirs.add(dir);
    return dir;
  }

  const origExists = fs.existsSync.bind(fs);
  const origRead = fs.readFileSync.bind(fs);
  const isVirt = (s: string) => s.startsWith("/tmp/virtual-") || s.startsWith("/virtual/");

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
      spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        const base = s.endsWith("/") ? s : s + "/";
        const childNames = new Set<string>();
        for (const f of mockFiles.keys())
          if (f.startsWith(base)) {
            const name = f.slice(base.length).split("/")[0];
            if (name) childNames.add(name);
          }
        for (const d of mockDirs)
          if (d.startsWith(base)) {
            const name = d.slice(base.length).split("/")[0];
            if (name) childNames.add(name);
          }
        return Array.from(childNames).sort() as unknown as fs.Dirent[];
      }) as unknown as typeof fs.readdirSync),
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

  test("refuses to run instead of reporting a round nobody executed", async () => {
    const repo = temporaryRepo("run");
    const runner = new AutonomousLoopRunner({
      baseRunId: "no-executor",
      repoPath: repo,
      initialPrompt: "Implement the feature",
      maxRounds: 3,
    });

    await expect(runner.run()).rejects.toThrow("autonomous loop has no round executor");
    expect(
      fs.existsSync(join(repo, ".olt", "capsules", "no-executor-loop-summary.json")),
    ).toBeFalse();
  });

  test("orchestrator:run fails with INVALID_STATE and writes nothing", async () => {
    const repo = temporaryRepo("cli");
    const failure = orchestratorRunCommand({
      repo,
      prompt: "Implement the feature",
      "run-id": "cli-no-executor",
    });

    await expect(failure).rejects.toThrow(HarnessError);
    await expect(failure).rejects.toThrow("requires a host-injected round executor");
    expect(fs.readdirSync(repo)).toEqual([]);
  });

  test("an injected executor still drives the loop", async () => {
    const repo = temporaryRepo("injected");
    const result = await orchestratorRunCommand(
      { repo, prompt: "Implement the feature", "run-id": "cli-with-executor" },
      {
        executor: {
          async executeRound(input) {
            return {
              runId: input.runId,
              round: input.round,
              status: "completed",
              criticDecision: "approve",
              tasks: [{ id: "task-1", status: "done", writeScope: ["src"] }],
              findings: [],
              gateResults: [{ gate_id: "gate-01", command_id: "c-1", status: "passed" }],
              summary: "Round complete.",
            };
          },
        },
      },
    );

    expect(result.final_status).toBe("converged_success");
    expect(result.rounds_executed).toBe(1);
  });
});
