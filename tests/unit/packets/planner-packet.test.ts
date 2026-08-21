import { describe, expect, test } from "bun:test";
import { initializePlannerPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/planner-packet.ts";
import { emptyGrantRun } from "./grant-run-fixture.ts";

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
});
