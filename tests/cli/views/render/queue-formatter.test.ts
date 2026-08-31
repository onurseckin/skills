import { describe, expect, test } from "bun:test";
import {
  formatQueueListBrief,
  formatQueueWaveBrief,
} from "../../../../olt/scripts/src/cli/formatters/queue-formatter.ts";

describe("formatQueueListBrief", () => {
  test("every non-empty partition is listed by id", () => {
    const brief = formatQueueListBrief({
      ready: ["t1"],
      leased: [{ id: "t2", agent: "worker-1" }],
      validating: ["t3"],
      blocked: [{ id: "t4", waitingOn: ["t2", "t3"] }],
      satisfied: ["t0"],
    });

    expect(brief).toContain("`t1`");
    expect(brief).toContain("`t2` (Agent: `worker-1`)");
    expect(brief).toContain("`t3`");
    expect(brief).toContain("`t4` (waiting for: `t2`, `t3`)");
    expect(brief).toContain("`t0`");
  });

  test("a leased entry with time remaining shows its expiry", () => {
    const brief = formatQueueListBrief({
      ready: [],
      leased: [{ id: "t1", agent: "worker-1", timeLeft: "12m" }],
      validating: [],
      blocked: [],
      satisfied: [],
    });
    expect(brief).toContain("`t1` (Agent: `worker-1`, Exp: 12m)");
  });

  test("every empty partition renders a dash rather than an empty cell", () => {
    const brief = formatQueueListBrief({
      ready: [],
      leased: [],
      validating: [],
      blocked: [],
      satisfied: [],
    });
    expect(brief).toContain("| 🟢 **Ready** | 0 | - |");
    expect(brief).toContain("| 🔄 **Leased** | 0 | - |");
    expect(brief).toContain("| 🔍 **Validating** | 0 | - |");
    expect(brief).toContain("| ⏳ **Blocked** | 0 | - |");
    expect(brief).toContain("| ✅ **Satisfied** | 0 | - |");
  });

  test("a repair-needed partition only appears in the table when it has entries", () => {
    const withRepair = formatQueueListBrief({
      ready: [],
      leased: [],
      validating: [],
      blocked: [],
      satisfied: [],
      repairNeeded: ["t9"],
    });
    expect(withRepair).toContain("🛠️ **Repair Needed**");
    expect(withRepair).toContain("`t9`");

    const withoutRepair = formatQueueListBrief({
      ready: [],
      leased: [],
      validating: [],
      blocked: [],
      satisfied: [],
      repairNeeded: [],
    });
    expect(withoutRepair).not.toContain("Repair Needed");
  });

  test("an explicit maxParallel overrides the default concurrency figure", () => {
    const brief = formatQueueListBrief(
      { ready: [], leased: [], validating: [], blocked: [], satisfied: [] },
      7,
    );
    expect(brief).toContain("/7 active lanes utilized");
  });
});

describe("formatQueueWaveBrief", () => {
  test("lists every claimable entry, defaulting missing labels and waves", () => {
    const brief = formatQueueWaveBrief({
      runId: "run-1",
      entries: [
        { taskId: "t1", label: "Task One", priority: 90, writeScope: ["src/a"], recordedWave: 1 },
        { taskId: "t2", label: null, priority: 50, writeScope: [], recordedWave: null },
      ],
      maxParallel: 3,
      topologySource: "recorded",
      topologyRevision: 5,
    });

    expect(brief).toContain("### Claimable Now: 2/3 conflict-free tasks");
    expect(brief).toContain("| `t1` | Task One | 90 | `src/a` | 1 |");
    expect(brief).toContain("| `t2` | - | 50 | `none` | unknown |");
    expect(brief).toContain("recorded at graph revision 5");
    expect(brief).toContain("task:claim --run run-1");
  });

  test("an absent topology source admits nothing was recorded, with no revision to cite", () => {
    const brief = formatQueueWaveBrief({
      runId: "run-1",
      entries: [],
      maxParallel: 1,
      topologySource: "absent",
      topologyRevision: null,
    });
    expect(brief).toContain("not recorded for this capsule");
  });

  test("a recorded topology with no revision number falls back to unknown", () => {
    const brief = formatQueueWaveBrief({
      runId: "run-1",
      entries: [],
      maxParallel: 1,
      topologySource: "recorded",
      topologyRevision: null,
    });
    expect(brief).toContain("recorded at graph revision unknown");
  });
});
