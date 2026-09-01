import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  analyzeRunForensics,
  type ForensicsAnalysisResult,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import type { Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

describe("Meta Auditor - Behavioral Forensics (Roles, Polling, Context) (in-memory virtual)", () => {
  let scratchDir: string;

  beforeEach(() => {
    setupVirtualMindFS();
    scratchDir = scratchRoot("meta-roles", "test");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  it("detects Heuristic 3: ROLE_BOUNDARY_DEVIATION for coordinator write & validator command execution", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-rbd-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-1",
    };
    fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const state: RunState = {
      version: "2.0.0",
      run_id: "run-rbd-test",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:05:00.000Z",
      status: "succeeded",
      tasks: {},
      agents: [],
    };
    fs.writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));

    const events = [
      {
        sequence: 1,
        kind: "tool-called",
        actor: "coordinator-lead",
        timestamp: "2026-08-23T00:01:00.000Z",
        payload: { tool: "write_to_file", arguments: { TargetFile: "/src/forbidden.ts" } },
      },
      {
        sequence: 2,
        kind: "tool-called",
        actor: "validator-qa",
        timestamp: "2026-08-23T00:02:00.000Z",
        payload: { tool: "run_command", arguments: { CommandLine: "rm -rf /tmp/something" } },
      },
      {
        sequence: 3,
        kind: "tool-called",
        actor: "validator-qa",
        timestamp: "2026-08-23T00:03:00.000Z",
        payload: { tool: "run_command", arguments: { CommandLine: "bun test tests/ok.test.ts" } },
      },
    ];
    fs.writeFileSync(
      join(scratchDir, "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const result: ForensicsAnalysisResult = analyzeRunForensics({ runRoot: scratchDir });
    const rbdIncidents = result.incidents.filter((i) => i.category === "ROLE_BOUNDARY_DEVIATION");
    expect(rbdIncidents).toHaveLength(2);

    const coordInc = rbdIncidents.find((i) => i.agentId === "coordinator-lead");
    expect(coordInc).toBeDefined();
    expect(coordInc?.severity).toBe("CRITICAL");

    const valInc = rbdIncidents.find((i) => i.agentId === "validator-qa");
    expect(valInc).toBeDefined();
    expect(valInc?.severity).toBe("HIGH");
  });

  it("detects Heuristic 4: POLLING_WASTE from high-frequency polling calls and polled events", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-pw-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-1",
    };
    fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const state: RunState = {
      version: "2.0.0",
      run_id: "run-pw-test",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:05:00.000Z",
      status: "succeeded",
      tasks: {},
      agents: [],
    };
    fs.writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));

    const events = [];
    for (let i = 1; i <= 5; i++) {
      events.push({
        sequence: i,
        kind: "tool-called",
        actor: "agent-loop",
        timestamp: `2026-08-23T00:01:0${i}.000Z`,
        payload: { tool: "manage_task", arguments: { Action: "status", TaskId: "t-1" } },
      });
    }
    fs.writeFileSync(
      join(scratchDir, "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const result: ForensicsAnalysisResult = analyzeRunForensics({ runRoot: scratchDir });
    const pwInc = result.incidents.find((i) => i.category === "POLLING_WASTE");
    expect(pwInc).toBeDefined();
    expect(pwInc?.severity).toBe("MEDIUM");
    expect(result.metrics.pollingCallsCount).toBe(5);
  });

  it("detects Heuristic 5: CONTEXT_OVERFLOW when agent token count exceeds threshold", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-co-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-1",
    };
    fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const state: RunState = {
      version: "2.0.0",
      run_id: "run-co-test",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:05:00.000Z",
      status: "succeeded",
      tasks: {},
      agents: [
        {
          id: "agent-heavy",
          role: "implementer",
          status: "released",
          tokens_in: 195000,
          tokens_out: 4000,
        },
      ],
    };
    fs.writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
    fs.writeFileSync(join(scratchDir, "events.jsonl"), "");

    const result: ForensicsAnalysisResult = analyzeRunForensics({ runRoot: scratchDir });
    const coInc = result.incidents.find((i) => i.category === "CONTEXT_OVERFLOW");
    expect(coInc).toBeDefined();
    expect(coInc?.severity).toBe("CRITICAL");
    expect(coInc?.agentId).toBe("agent-heavy");
  });
});
