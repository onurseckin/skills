import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  analyzeRunForensics,
  type ForensicsAnalysisResult,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import type { Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

describe("Meta Auditor - Behavioral Forensics (Ghost Leases & Stragglers) (in-memory virtual)", () => {
  const scratchDir = `${process.cwd()}/.olt/virtual-meta-leases-scratch`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(scratchDir);

    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return mockFiles.has(s) || mockDirs.has(s);
      }),
    );

    spies.push(
      spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${s}'`);
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
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("detects Heuristic 6: GHOST_LEASE when task remains leased to a released agent", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-gl-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-ghost",
    };
    mockFiles.set(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const state: RunState = {
      version: "2.0.0",
      run_id: "run-gl-test",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:05:00.000Z",
      status: "active",
      tasks: {
        "task-ghost": {
          id: "task-ghost",
          title: "Orphaned Task",
          description: "Desc",
          status: "leased",
          kind: "implementation",
          write_scope: ["src/ghost.ts"],
          lease: {
            agent_id: "agent-departed",
            lease_token: "tok-123",
            expires_at: "2026-08-23T00:10:00.000Z",
          },
        },
      },
      agents: [
        {
          id: "agent-departed",
          role: "implementer",
          status: "released",
          tokens_in: 1000,
          tokens_out: 200,
        },
      ],
    };
    mockFiles.set(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
    mockFiles.set(join(scratchDir, "events.jsonl"), "");

    const result: ForensicsAnalysisResult = analyzeRunForensics({ runRoot: scratchDir });
    const glInc = result.incidents.find((i) => i.category === "GHOST_LEASE");
    expect(glInc).toBeDefined();
    expect(glInc?.severity).toBe("HIGH");
    expect(glInc?.taskId).toBe("task-ghost");
    expect(glInc?.agentId).toBe("agent-departed");
  });

  it("detects Heuristic 7: STRAGGLER tasks that dominate execution wall-clock time", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-str-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-1",
    };
    mockFiles.set(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const state: RunState = {
      version: "2.0.0",
      run_id: "run-str-test",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:10:00.000Z",
      status: "succeeded",
      tasks: {
        "task-fast-1": {
          id: "task-fast-1",
          title: "Fast 1",
          description: "Fast 1",
          status: "succeeded",
          kind: "implementation",
          write_scope: ["src/1.ts"],
          attempts: [
            {
              attempt: 1,
              status: "succeeded",
              started_at: "2026-08-23T00:00:00.000Z",
              completed_at: "2026-08-23T00:00:10.000Z",
            },
          ],
        },
        "task-fast-2": {
          id: "task-fast-2",
          title: "Fast 2",
          description: "Fast 2",
          status: "succeeded",
          kind: "implementation",
          write_scope: ["src/2.ts"],
          attempts: [
            {
              attempt: 1,
              status: "succeeded",
              started_at: "2026-08-23T00:00:15.000Z",
              completed_at: "2026-08-23T00:00:25.000Z",
            },
          ],
        },
        "task-fast-3": {
          id: "task-fast-3",
          title: "Fast 3",
          description: "Fast 3",
          status: "succeeded",
          kind: "implementation",
          write_scope: ["src/3.ts"],
          attempts: [
            {
              attempt: 1,
              status: "succeeded",
              started_at: "2026-08-23T00:00:30.000Z",
              completed_at: "2026-08-23T00:00:40.000Z",
            },
          ],
        },
        "task-slow-1": {
          id: "task-slow-1",
          title: "Slow Straggler",
          description: "Slow Straggler",
          status: "succeeded",
          kind: "implementation",
          write_scope: ["src/4.ts"],
          attempts: [
            {
              attempt: 1,
              status: "succeeded",
              started_at: "2026-08-23T00:01:00.000Z",
              completed_at: "2026-08-23T00:04:20.000Z",
            },
          ],
        },
      },
      agents: [],
    };
    mockFiles.set(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
    mockFiles.set(join(scratchDir, "events.jsonl"), "");

    const result: ForensicsAnalysisResult = analyzeRunForensics({ runRoot: scratchDir });
    const strInc = result.incidents.find((i) => i.category === "STRAGGLER");
    expect(strInc).toBeDefined();
    expect(strInc?.taskId).toBe("task-slow-1");
    expect(strInc?.severity).toBe("MEDIUM");
  });
});
