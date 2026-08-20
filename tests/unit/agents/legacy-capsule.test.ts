import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { readAgentLedger } from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/ledger.ts";
import { taskLineage } from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/lineage.ts";

const capsule = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  ".capsules",
  "2026-08-17-skills-documentation-elevation",
);

describe("agent ledger compatibility", () => {
  test("a capsule written before the ledger existed still loads and reads as empty", () => {
    const loaded = loadRun(capsule);
    expect(loaded.state.agents).toBeUndefined();
    expect(readAgentLedger(loaded.state)).toEqual([]);
    expect(taskLineage(readAgentLedger(loaded.state), "task-1").agents).toEqual([]);
    expect(Object.keys(loaded.state.tasks ?? {}).length).toBeGreaterThan(0);
  });

  test("treats a malformed ledger as an integrity failure, not something to repair", () => {
    expect(() => readAgentLedger({ agents: "worker-1" })).toThrow("must be an array");
    expect(() => readAgentLedger({ agents: [{ id: "worker-1" }] })).toThrow(
      "is not an agent grant record",
    );
    expect(() =>
      readAgentLedger({
        agents: [
          {
            id: "worker-1",
            role: "implementer",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: "2026-08-19T00:00:00.000Z",
            status: "active",
            tools_used: [
              { name: "Read", evidence_class: "vibes", first_reported_at: "2026-08-19T00:00:00Z" },
            ],
          },
        ],
      }),
    ).toThrow("is not an agent grant record");
    expect(() =>
      readAgentLedger({
        agents: [
          {
            id: "worker-1",
            role: "implementer",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: "2026-08-19T00:00:00.000Z",
            status: "active",
            thinking_level: { value: "ultra", evidence_class: "host_reported" },
          },
        ],
      }),
    ).toThrow("is not an agent grant record");
  });
});
