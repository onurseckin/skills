import { describe, expect, it } from "bun:test";
import {
  parseDurationOrNumber,
  parseBudgetsObject,
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  parseCharter,
} from "../../../olt/scripts/src/mind/governance/index.ts";

describe("Governance Policy Schema & Budget Parser", () => {
  it("parses duration strings and numbers accurately", () => {
    expect(parseDurationOrNumber(5000)).toBe(5000);
    expect(parseDurationOrNumber("5s")).toBe(5000);
    expect(parseDurationOrNumber("2m")).toBe(120000);
    expect(parseDurationOrNumber("1h")).toBe(3600000);
  });

  it("parses budgets object with default fallbacks", () => {
    const b = parseBudgetsObject({});
    expect(b.session_budget_minutes).toBe(DEFAULT_MIND_BUDGET.session_budget_minutes);
    expect(b.per_task_timeout_seconds).toBe(DEFAULT_MIND_BUDGET.per_task_timeout_seconds);
  });

  it("parses charter and validates goals", () => {
    const yaml = `identity: mind
repoRoots:
  - "."
goals:
  - id: core-reliability
    statement: Ensure zero regressions across core subsystems
    priority: 1
nonGoals:
  - out-of-scope
prohibitions:
  - no-destructive-ops
`;
    const charter = parseCharter(yaml);
    expect(charter.goals.length).toBe(1);
    expect(charter.identity).toBe("mind");
  });
});
