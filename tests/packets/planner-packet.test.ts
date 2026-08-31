import { describe, expect, test } from "bun:test";
import { initializePlannerPacket } from "../../olt/scripts/src/packets/planner-packet.ts";
import { emptyGrantRun, seedSingleTaskGraph } from "./grant-run-fixture.ts";

describe("initializePlannerPacket", () => {
  test("rejects a blank planner id", async () => {
    const { run } = await emptyGrantRun("planner-packet-blank-");
    await expect(initializePlannerPacket(run, "   ")).rejects.toThrow();
  });

  test("publishes the initial planner packet with write scope over planning/requirements.json and graph.json", async () => {
    const { run } = await emptyGrantRun("planner-packet-publish-");
    const published = await initializePlannerPacket(run, "planner-1");
    expect(published.record.status).toBe("published");
    expect(published.packet.metadata.role).toBe("planner");
    expect(published.packet.metadata.agent_id).toBe("planner-1");
    expect(published.packet.markdown).toContain("planning/requirements.json");
    expect(published.packet.markdown).toContain("planning/graph.json");
    expect(published.packet.markdown).toContain("plan:apply");
  });

  // C10 / plan:apply reachability: the packet must embed the run's LIVE graph revision, not a
  // hardcoded 0 — otherwise the plan:apply --expected-revision it prescribes is refused on any
  // run that has already compiled a graph (revision-guard.ts requires exactly +1 over current).
  test("issues the packet at the run's live graph revision on an already-compiled run", async () => {
    const { run } = await emptyGrantRun("planner-packet-live-revision-");
    seedSingleTaskGraph(run);
    const published = await initializePlannerPacket(run, "planner-1");
    expect(published.packet.metadata.graph_revision).toBe(1);
    expect(published.packet.markdown).toMatch(/"--expected-revision",\s*"1"/);
  });

  test("an explicit --expected-revision matching the live revision is honored", async () => {
    const { run } = await emptyGrantRun("planner-packet-expected-match-");
    seedSingleTaskGraph(run);
    const published = await initializePlannerPacket(run, "planner-1", 1);
    expect(published.packet.metadata.graph_revision).toBe(1);
  });

  test("an explicit --expected-revision that has drifted from the live revision is refused", async () => {
    const { run } = await emptyGrantRun("planner-packet-expected-mismatch-");
    seedSingleTaskGraph(run);
    await expect(initializePlannerPacket(run, "planner-1", 0)).rejects.toThrow(
      /graph revision is 1, expected 0/,
    );
  });
});
