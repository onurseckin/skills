import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { nextActions } from "../../../olt/scripts/src/reporting/next-actions.ts";
import { actions, ENTRYPOINT, RUN, view } from "./actions-fixture.ts";
import { dispatchFailures } from "../core/dispatchable.ts";

const rendered = (status: string) => actions(view(status)).text;

const grant: AgentGrantRecord = {
  id: "worker",
  role: "implementer",
  parent_agent_id: null,
  parent_task_id: "T-1",
  host: "claude-code",
  granted_at: "2026-08-13T12:00:00.000Z",
  status: "active",
};

describe("state-specific resumable argv", () => {
  test("every task status yields commands the registry can dispatch", () => {
    for (const status of [
      "proposed",
      "ready",
      "retry_ready",
      "changes_requested",
      "leased",
      "running",
      "submitted",
      "validating",
      "validated",
      "gating",
      "branched",
      "escalated",
      "done",
    ]) {
      expect(dispatchFailures(nextActions(RUN, ENTRYPOINT, view(status)).argv)).toEqual([]);
    }
  });

  test("orients a fresh reader before it changes anything", () => {
    const opened = actions(view("ready"), [grant]);
    expect(opened.text).toContain(" run:status ");
    expect(opened.text).toContain(" doctor ");
    expect(opened.text).toContain(" agent:list ");
    // No grant ledger and no branches: the reads that would report on them are not offered.
    expect(rendered("ready")).not.toContain(" agent:list ");
    expect(rendered("ready")).not.toContain(" branch:status ");
  });

  test("dispatches a ready task through the wave, not one task at a time", () => {
    const ready = rendered("ready");
    expect(ready).toContain(" queue:wave ");
    expect(ready).toContain(" queue:next ");
    expect(ready).toContain(" task:claim ");
    expect(ready).toContain("--role implementer");
    expect(rendered("changes_requested")).toContain("--role repairer");
    expect(rendered("changes_requested")).toContain("--agent worker");
  });

  test("names the lease commands while an agent holds the work", () => {
    for (const status of ["leased", "running"]) {
      const held = rendered(status);
      expect(held).toContain(" task:heartbeat ");
      expect(held).toContain(" task:submit ");
      expect(held).toContain("<lease-token-returned-by:task:claim>");
      expect(held).not.toContain("token_digest");
    }
  });

  test("carries a submitted task into validation and a validating one to a verdict", () => {
    expect(rendered("submitted")).toContain(" task:validate-start ");
    const validating = rendered("validating");
    expect(validating).toContain(" task:probe ");
    expect(validating).toContain(" task:review ");
    expect(validating).toContain("--status <pass-or-fail>");
    expect(validating).toContain("--gate G-task");
    expect(validating).toContain("--validator validator");
  });

  test("stops naming the probe once the configured rounds are recorded", () => {
    const probed = view("validating");
    (probed.tasks as JsonObject[])[0]!.probe_round = 5;
    const text = actions(probed).text;
    expect(text).not.toContain(" task:probe ");
    expect(text).toContain(" task:review ");
  });

  test("answers every open probe demand in the verdict it names", () => {
    const probed = view("validating");
    (probed.tasks as JsonObject[])[0]!.open_finding_ids = ["probe-T-1-01-1", "probe-T-1-01-2"];
    const text = actions(probed).text;
    expect(text).toContain("--resolve probe-T-1-01-1=<command-id-answering:probe-T-1-01-1>");
    expect(text).toContain("--resolve probe-T-1-01-2=<command-id-answering:probe-T-1-01-2>");
  });

  test("names no resolution when the validator owes no answer", () => {
    expect(rendered("validating")).not.toContain("--resolve");
  });

  test("omits a gate whose recorded run already succeeded", () => {
    const proven = view("validating", {
      commands: [
        { id: "C-1", actor: "validator", status: "succeeded", task_id: "T-1", gate_id: "G-task" },
      ],
    });
    expect(actions(proven).text).not.toContain("--gate G-task");
  });

  test("emits only the mandatory task gates that bind this task's requirements", () => {
    const state = view("validating");
    (state.gates as JsonObject[]).push(
      {
        id: "G-unrelated",
        scope: "task",
        cwd: ".",
        command: ["bun", "test", "unrelated"],
        requirement_ids: ["R-2"],
        mandatory: true,
      },
      {
        id: "G-optional",
        scope: "task",
        cwd: ".",
        command: ["bun", "test", "optional"],
        requirement_ids: ["R-1"],
        mandatory: false,
      },
    );
    const text = actions(state).text;
    expect(text).toContain("--gate G-task");
    expect(text).not.toContain("--gate G-unrelated");
    expect(text).not.toContain("--gate G-optional");
    expect(text).not.toContain("--gate G-run");
  });

  test("reports the sign-off window as unresumable instead of naming a command for it", () => {
    for (const status of ["validated", "gating"]) {
      const stuck = actions(view(status));
      expect(stuck.argv.some((argv) => argv.includes("task:review"))).toBeFalse();
      expect(stuck.unavailable).toEqual([
        `task T-1 is ${status}: that step runs inside task:review, and no CLI command resumes it from here`,
      ]);
    }
  });

  test("sends an escalated task back to replanning", () => {
    expect(rendered("escalated")).toContain(" plan:replan ");
  });

  test("prioritizes recovery over actions authenticated by an expired lease", () => {
    const stale = view("leased", {
      stale_evidence: ["task T-1 lease expired at 2026-08-13T12:00:00.000Z"],
    });
    const text = actions(stale).text;
    expect(text).toContain(" recover ");
    expect(text).toContain("--grace-seconds 0");
    expect(text).not.toContain(" task:heartbeat ");
    expect(text).not.toContain(" task:submit ");
  });

  test("pauses a task bound to a requirement awaiting authority, and says why", () => {
    const paused = view("ready", {
      requirements: [{ id: "R-1", disposition: "needs_authority", authority_status: null }],
    });
    const result = actions(paused);
    expect(result.text).not.toContain(" task:claim ");
    expect(result.text).not.toContain(" queue:wave ");
    expect(result.unavailable).toEqual([
      "requirement R-1 is paused for an authority decision and no registry command records one; every task bound to it stays undispatched",
    ]);
  });

  test("dispatches again once the authority decision is recorded", () => {
    const granted = view("ready", {
      requirements: [{ id: "R-1", disposition: "needs_authority", authority_status: "granted" }],
    });
    const result = actions(granted);
    expect(result.text).toContain(" task:claim ");
    expect(result.unavailable).toEqual([]);
  });
});
