import { describe, expect, it } from "bun:test";
import {
  dagCheckCommand,
  dagHealCommand,
} from "../../../olt/scripts/src/cli/commands/dag-ops/index.ts";
import { DAG_COMMANDS } from "../../../olt/scripts/src/cli/registry/dag.ts";

describe("DAG Commands - CLI Handlers and Registry", () => {
  it("defines dag:check and dag:heal in DAG_COMMANDS spec", () => {
    const names = DAG_COMMANDS.map((s) => s.name);
    expect(names).toContain("dag:check");
    expect(names).toContain("dag:heal");
  });

  it("dagCheckCommand executes without run flag and reports empty DAG cleanly", () => {
    const output = dagCheckCommand({});
    expect(output.ok).toBe(true);
    expect(output.markdown).toContain("DAG Engine Health & Diagnostics");
    expect(output.result.taskCount).toBe(0);
  });

  it("dagHealCommand executes without run flag and reports clean status", () => {
    const output = dagHealCommand({});
    expect(output.ok).toBe(true);
    expect(output.markdown).toContain("DAG Engine Healing Operations");
    expect(output.result.healedTasks).toHaveLength(0);
  });
});
