import { describe, expect, it } from "bun:test";
import {
  inspectCapsuleAuxiliary,
  parsePayloadNumber,
  parsePayloadString,
  parsePayloadStringArray,
} from "../../../../olt/scripts/src/reporting/living-tracer/index.ts";

describe("reporting/living-tracer setup & utilities suite", () => {
  it("parses payload string, number, and string arrays accurately", () => {
    const payload = {
      task: "task-01",
      count: 42,
      tags: ["frontend", "tui", "streams"],
      nested: { obj: true },
    };

    expect(parsePayloadString(payload, "task")).toBe("task-01");
    expect(parsePayloadString(payload, "nonexistent")).toBeNull();
    expect(parsePayloadString(null, "task")).toBeNull();

    expect(parsePayloadNumber(payload, "count")).toBe(42);
    expect(parsePayloadNumber(payload, "nonexistent")).toBeNull();

    expect(parsePayloadStringArray(payload, "tags")).toEqual(["frontend", "tui", "streams"]);
    expect(parsePayloadStringArray(payload, "task")).toEqual(["task-01"]);
    expect(parsePayloadStringArray(payload, "nonexistent")).toEqual([]);
  });

  it("inspects capsule auxiliary for missing directories safely", () => {
    const aux = inspectCapsuleAuxiliary("/nonexistent/capsule/path");
    expect(aux.hasAuxiliary).toBe(false);
    expect(aux.artifacts.length).toBe(0);
    expect(aux.subagentLogs.length).toBe(0);
  });
});
