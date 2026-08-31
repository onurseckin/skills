import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { BranchView } from "../../../olt/scripts/src/reporting/action-types.ts";
import {
  branchActions,
  openBranchActions,
} from "../../../olt/scripts/src/reporting/branch-actions.ts";
import { registryArgv } from "../../../olt/scripts/src/reporting/registry-argv.ts";
import { actions, ENTRYPOINT, RUN, view } from "./actions-fixture.ts";
import { dispatchFailure, dispatchFailures } from "../core/dispatchable.ts";

function branch(overrides: Partial<BranchView> = {}): BranchView {
  return {
    id: "B-1",
    parent_task_id: "T-1",
    parent_agent_id: "worker",
    status: "open",
    reason: "the parser blocks the API change",
    sub_tasks: [{ id: "S-1", label: "Fix the parser", status: "open", agent_id: null }],
    ...overrides,
  };
}

const text = (branches: readonly BranchView[]) =>
  openBranchActions(ENTRYPOINT, RUN, branches)
    .argv.map((argv) => argv.join(" "))
    .join("\n");

describe("registry-resolved argv", () => {
  test("the guard itself refuses argv that names nothing runnable", () => {
    expect(dispatchFailure(["node", ENTRYPOINT, "run:status"])).toContain(
      "does not start with bun",
    );
    expect(dispatchFailure(["bun", ENTRYPOINT])).toContain("names no command");
    expect(dispatchFailure(["bun", ENTRYPOINT, "nonexistent-command"])).toBe(
      "no registry command named nonexistent-command",
    );
    expect(dispatchFailure(["bun", ENTRYPOINT, "report:leases"])).toBe(
      "report:leases is missing --run",
    );
    expect(dispatchFailure(["bun", ENTRYPOINT, "run:status", "--run", RUN, "--nope"])).toContain(
      "unknown option",
    );
    expect(dispatchFailure(["bun", ENTRYPOINT, "run:status", "--run", RUN, "--", "bun"])).toContain(
      "does not accept -- arguments",
    );
  });

  test("refuses to name a command the registry does not have", () => {
    expect(registryArgv(ENTRYPOINT, "nonexistent-command", [["run", RUN]])).toBeUndefined();
    expect(registryArgv(ENTRYPOINT, "packet", [["run", RUN]])).toBeUndefined();
    expect(registryArgv(ENTRYPOINT, "gate", [["run", RUN]])).toBeUndefined();
    expect(registryArgv(ENTRYPOINT, "finish", [["run", RUN]])).toBeUndefined();
    expect(registryArgv(ENTRYPOINT, "begin-validation", [["run", RUN]])).toBeUndefined();
    expect(registryArgv(ENTRYPOINT, "", [])).toBeUndefined();
  });

  test("refuses a flag the command's own spec does not declare", () => {
    expect(
      registryArgv(ENTRYPOINT, "run:status", [
        ["run", RUN],
        ["max-parallel", "3"],
      ]),
    ).toBeUndefined();
  });

  test("refuses a -- tail on a command that takes none", () => {
    expect(registryArgv(ENTRYPOINT, "run:status", [["run", RUN]], ["bun", "test"])).toBeUndefined();
    expect(
      registryArgv(ENTRYPOINT, "run:exec", [["run", RUN]], ["bun", "test"])?.slice(-3),
    ).toEqual(["--", "bun", "test"]);
  });

  test("renders a required flag the caller could not fill as a hole, not a value", () => {
    const argv = registryArgv(ENTRYPOINT, "plan:compile", [["run", RUN]])!;
    expect(argv).toEqual([
      "bun",
      ENTRYPOINT,
      "plan:compile",
      "--run",
      RUN,
      "--actor",
      "<actor-for:plan:compile>",
      "--completion-gate",
      "<completion-gate-for:plan:compile>",
    ]);
    expect(dispatchFailures([argv])).toEqual([]);
  });

  test("keeps a bool flag valueless", () => {
    expect(registryArgv(ENTRYPOINT, "branch:status", [["run", RUN], ["all"]])).toEqual([
      "bun",
      ENTRYPOINT,
      "branch:status",
      "--run",
      RUN,
      "--all",
    ]);
  });
});

describe("branch next actions", () => {
  test("claims an unclaimed sub-task and never collects before it is terminal", () => {
    const open = text([branch()]);
    expect(open).toContain(" branch:claim ");
    expect(open).toContain("--sub-task S-1");
    expect(open).not.toContain(" branch:submit ");
    expect(open).not.toContain(" branch:collect ");
    expect(open).toContain(" branch:abandon ");
  });

  test("submits a claimed sub-task under the agent the ledger recorded", () => {
    const claimed = text([
      branch({
        sub_tasks: [{ id: "S-1", label: "Fix the parser", status: "claimed", agent_id: "sub-1" }],
      }),
    ]);
    expect(claimed).toContain(" branch:submit ");
    expect(claimed).toContain("--agent sub-1");
    expect(claimed).toContain("<sub-task-token-returned-by:branch:claim>");
    expect(claimed).not.toContain(" branch:collect ");
  });

  test("names a sub-agent hole when a claimed sub-task recorded none", () => {
    const claimed = text([
      branch({
        sub_tasks: [{ id: "S-1", label: "Fix the parser", status: "claimed", agent_id: null }],
      }),
    ]);
    expect(claimed).toContain("--agent <sub-agent-for:S-1>");
  });

  test("collects once every sub-task is terminal", () => {
    const done = text([
      branch({
        status: "collecting",
        sub_tasks: [
          { id: "S-1", label: "Fix the parser", status: "submitted", agent_id: "sub-1" },
          { id: "S-2", label: "Drop the shim", status: "abandoned", agent_id: "sub-2" },
        ],
      }),
    ]);
    expect(done).toContain(" branch:collect ");
    expect(done).toContain("--agent worker");
    expect(done).not.toContain(" branch:claim ");
  });

  test("says nothing about a branch that is already settled", () => {
    expect(text([branch({ status: "collected" })])).toBe("");
    expect(text([branch({ status: "abandoned" })])).toBe("");
    expect(openBranchActions(ENTRYPOINT, RUN, []).argv).toEqual([]);
  });

  test("every branch argv is one the CLI can dispatch", () => {
    const result = branchActions(ENTRYPOINT, RUN, branch());
    expect(dispatchFailures(result.argv)).toEqual([]);
    expect(result.unavailable).toEqual([]);
  });

  test("an open branch reaches the run's next actions and offers the ledger read", () => {
    const state: JsonObject = view("branched", {
      branches: [branch() as unknown as JsonObject],
    });
    const result = actions(state);
    expect(result.text).toContain(" branch:status ");
    expect(result.text).toContain("--all");
    expect(result.text).toContain(" branch:claim ");
  });
});
