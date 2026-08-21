import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { assertGrantedCommand } from "../../../orchestrating-long-tasks/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";
import type { Flags } from "../../../orchestrating-long-tasks/scripts/src/cli/options.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { emptyGrantRun } from "./grant-run-fixture.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

describe("assertGrantedCommand", () => {
  test("swallows a state.json that exists but does not belong to a real capsule", async () => {
    const { repo } = await emptyGrantRun("command-authority-broken-capsule-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    // capsuleState()'s existsSync(state.json) check passes, but loadRun then fails (no
    // manifest.json/prompt.md/events.jsonl alongside it) — the catch branch must swallow
    // that and leave enforcement a no-op rather than let the HarnessError propagate.
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).not.toThrow();
  });

  test("enforces the acting agent's granted role once a ledger entry is found", async () => {
    const { run } = await emptyGrantRun("command-authority-ledger-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "agent-1",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    // A validator's contract does not grant task:submit, so the ledger lookup must resolve
    // and assertRoleMayInvoke must run and refuse it.
    const flags: Flags = { run, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).toThrow("may not invoke");

    // A command validators are actually granted must sail through the same lookup.
    expect(() => assertGrantedCommand(spec("task:probe"), flags)).not.toThrow();
  });

  test("excludes a command's own subject flag from the candidates it reads the acting agent from", () => {
    // queue:pop's subject flag is "agent", so actingAgent must look at validator/critic/actor
    // instead — exercised here via a nonexistent capsule, which only needs the subject-flag
    // exclusion itself to run, not a resolved ledger entry.
    const flags: Flags = { run: "/nonexistent/capsule", actor: "coordinator" };
    expect(() => assertGrantedCommand(spec("queue:pop"), flags)).not.toThrow();
  });
});
