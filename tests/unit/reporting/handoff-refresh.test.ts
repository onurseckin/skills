import { describe, expect, test } from "bun:test";
import {
  refreshHandoff,
  refreshHandoffOnEscalation,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/handoff.ts";

describe("refreshHandoff", () => {
  test("a run that cannot be rendered yields undefined instead of throwing", () => {
    expect(refreshHandoff("/nonexistent/run/root/for/sure")).toBeUndefined();
  });
});

describe("refreshHandoffOnEscalation", () => {
  test("only escalation triggers a refresh attempt", () => {
    expect(refreshHandoffOnEscalation("/nonexistent/run/root", "running")).toBeUndefined();
  });

  test("an escalated status that fails to refresh still yields undefined, not a throw", () => {
    expect(
      refreshHandoffOnEscalation("/nonexistent/run/root/for/sure", "escalated"),
    ).toBeUndefined();
  });
});
