import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import type { JsonValue } from "../../../olt/scripts/src/core/contracts/index.ts";
import { reconcileDualChannelTelemetry } from "../../../olt/scripts/src/workflow/agents/index.ts";

function createMockCapsule(baseDir: string, state: Record<string, unknown>): string {
  const runRoot = join(baseDir, "run_test_1");
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(
    join(runRoot, "manifest.json"),
    canonicalJsonBytes({
      runId: "test-run",
      createdAt: "2026-08-20T00:00:00.000Z",
    } as unknown as JsonValue),
  );
  writeFileSync(
    join(runRoot, "index.json"),
    canonicalJsonBytes({ runId: "test-run", status: "running" } as unknown as JsonValue),
  );
  writeFileSync(join(runRoot, "state.json"), canonicalJsonBytes(state as unknown as JsonValue));
  writeFileSync(join(runRoot, "prompt.md"), "Test prompt");
  return runRoot;
}

describe("workflow/agents/telemetry-reconciler", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reconciler-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("reports synced when Channel 1 grants and Channel 2 transcripts match perfectly", async () => {
    const state = {
      agents: [
        {
          id: "agent-1",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
        },
      ],
    };
    const runRoot = createMockCapsule(tempDir, state);
    const txDir = join(runRoot, "transcripts");
    mkdirSync(txDir, { recursive: true });
    writeFileSync(join(txDir, "agent-1.json"), "{}");

    const result = await reconcileDualChannelTelemetry(runRoot);
    expect(result.status).toBe("synced");
    expect(result.channel1Count).toBe(1);
    expect(result.channel2Count).toBe(1);
    expect(result.ghostAgents).toHaveLength(0);
    expect(result.untrackedAgents).toHaveLength(0);
    expect(result.integrityViolations).toHaveLength(0);
    expect(result.syncedAgentIds).toContain("agent-1");
  });

  test("detects ghost agents when an active grant has no host process or transcript", async () => {
    const state = {
      agents: [
        {
          id: "agent-ghost-1",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
        },
        {
          id: "agent-released",
          role: "completeness-critic",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "released",
        },
      ],
    };
    const runRoot = createMockCapsule(tempDir, state);

    const result = await reconcileDualChannelTelemetry(runRoot, undefined, {
      hostProcesses: [],
    });
    expect(result.status).toBe("drift_detected");
    expect(result.ghostAgents).toHaveLength(1);
    expect(result.ghostAgents[0]?.agentId).toBe("agent-ghost-1");
    expect(result.untrackedAgents).toHaveLength(0);
  });

  test("detects untracked agents in transcripts and host processes", async () => {
    const state = {
      agents: [],
    };
    const runRoot = createMockCapsule(tempDir, state);
    const txDir = join(runRoot, "transcripts");
    mkdirSync(txDir, { recursive: true });
    writeFileSync(join(txDir, "rogue-agent-tx.jsonl"), "{}");

    const subDir = join(runRoot, "subagents");
    mkdirSync(join(subDir, "rogue-agent-sub"), { recursive: true });

    const result = await reconcileDualChannelTelemetry(runRoot, undefined, {
      hostProcesses: [{ agentId: "rogue-agent-proc", pid: 9999 }],
    });
    expect(result.status).toBe("drift_detected");
    expect(result.ghostAgents).toHaveLength(0);
    expect(result.untrackedAgents).toHaveLength(3);
    const untrackedIds = result.untrackedAgents.map((u) => u.agentId);
    expect(untrackedIds).toContain("rogue-agent-tx");
    expect(untrackedIds).toContain("rogue-agent-sub");
    expect(untrackedIds).toContain("rogue-agent-proc");
  });

  test("detects self-loop lineage cycle as integrity violation", async () => {
    const state = {
      agents: [
        {
          id: "agent-cycle",
          role: "planner",
          parent_agent_id: "agent-cycle",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
        },
      ],
    };
    const runRoot = createMockCapsule(tempDir, state);

    const result = await reconcileDualChannelTelemetry(runRoot);
    expect(result.status).toBe("integrity_error");
    expect(result.integrityViolations.some((v) => v.code === "LINEAGE_CYCLE_DETECTED")).toBe(true);
  });

  test("detects multi-node lineage cycle as integrity violation", async () => {
    const state = {
      agents: [
        {
          id: "node-a",
          role: "implementer",
          parent_agent_id: "node-b",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
        },
        {
          id: "node-b",
          role: "validator",
          parent_agent_id: "node-a",
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
        },
      ],
    };
    const runRoot = createMockCapsule(tempDir, state);

    const result = await reconcileDualChannelTelemetry(runRoot);
    expect(result.status).toBe("integrity_error");
    expect(result.integrityViolations.some((v) => v.code === "LINEAGE_CYCLE_DETECTED")).toBe(true);
  });

  test("detects corrupt token state as integrity violation", async () => {
    const state = {
      agents: [
        {
          id: "agent-neg-tokens",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
          tokens_in: -50,
        },
      ],
    };
    const runRoot = createMockCapsule(tempDir, state);

    const result = await reconcileDualChannelTelemetry(runRoot);
    expect(result.status).toBe("integrity_error");
    expect(result.integrityViolations.some((v) => v.code === "TOKEN_STATE_CORRUPT")).toBe(true);
  });

  test("detects corrupt ledger structure as integrity violation", async () => {
    const state = {
      agents: "corrupted-ledger-string",
    };
    const runRoot = createMockCapsule(tempDir, state);

    const result = await reconcileDualChannelTelemetry(runRoot);
    expect(result.status).toBe("integrity_error");
    expect(result.integrityViolations.some((v) => v.code === "LEDGER_INTEGRITY_ERROR")).toBe(true);
  });
});
