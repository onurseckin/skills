import { describe, expect, it } from "bun:test";
import {
  mapPriority,
  mapFeedbackPriorityToTaskPriority,
} from "../../../../olt/scripts/src/mind/tasks/discovery/index.ts";

describe("Task Discovery Priority Mapping Suite (Part 2)", () => {
  it("maps discovery severity to task priority correctly", () => {
    expect(mapPriority("critical")).toBeDefined();
    expect(mapPriority("high")).toBeDefined();
    expect(mapPriority("medium")).toBeDefined();
    expect(mapPriority("low")).toBeDefined();
  });

  it("maps feedback priority to task priority correctly", () => {
    expect(mapFeedbackPriorityToTaskPriority("CRITICAL")).toBeDefined();
    expect(mapFeedbackPriorityToTaskPriority("HIGH")).toBeDefined();
    expect(mapFeedbackPriorityToTaskPriority("NORMAL")).toBeDefined();
  });
});
