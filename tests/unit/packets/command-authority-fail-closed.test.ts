import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertGrantedCommand } from "../../../olt/scripts/src/packets/command-authority.ts";
import {
  GRANT_BOOTSTRAP_ALLOWLIST,
  PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS,
  requiresActingIdentity,
} from "../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { emptyGrantRun } from "./grant-run-fixture.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

describe("assertGrantedCommand hole 1: no --run resolves", () => {
  test("denies a non-allowlisted command with no --run", () => {
    expect(() => assertGrantedCommand(spec("task:heartbeat"), {})).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("permits mind:init, which structurally never carries --run", () => {
    expect(() => assertGrantedCommand(spec("mind:init"), { actor: "owner" })).not.toThrow();
  });

  test("permits previously-stranded context-free commands that declare no run/run-id flag at all", () => {
    expect(() => assertGrantedCommand(spec("mind:queue:list"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("install"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("usage:report"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("quota:check"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("agent:define"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("coverage:check"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("capture:init"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("capture:eval"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("smart-task:plan"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("smart-task:ingest"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("installation-status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("mind:audit:live"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("mind:queue:add"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("mind:queue:drain"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("mind:queue:seal"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("mind:queue:clean"), {})).not.toThrow();
  });

  test("denies a command that declares an optional run flag but omits it, distinct from one that declares none", () => {
    expect(() => assertGrantedCommand(spec("shell"), { actor: "someone" })).toThrow(
      "not on the grant bootstrap allowlist",
    );
    expect(() => assertGrantedCommand(spec("scope:expand"), { actor: "someone" })).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });
});

describe("assertGrantedCommand hole 2: no acting identity resolves", () => {
  test("denies a non-allowlisted command with --run but no identity flag", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("permits task:check with --run but no identity flag, the retired-actor bricking trap", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("task:check"), flags)).not.toThrow();
  });

  test("permits doctor with --run but no identity flag", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("doctor"), flags)).not.toThrow();
  });
});

describe("assertGrantedCommand hole 3: capsule state cannot load", () => {
  test("denies a non-allowlisted command against an unreadable capsule", async () => {
    const { repo } = await emptyGrantRun("fail-closed-hole3-deny-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, agent: "agent-1" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("permits agent:register against an unreadable capsule, the grant-genesis bootstrap case", async () => {
    const { repo } = await emptyGrantRun("fail-closed-hole3-permit-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, actor: "first-orchestrator" };
    expect(() => assertGrantedCommand(spec("agent:register"), flags)).not.toThrow();
  });
});

describe("assertGrantedCommand hole 4: id absent from ledger", () => {
  test("denies a non-allowlisted command for an unregistered ghost actor", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole4-ghost-");
    const flags: Flags = { run, agent: "ghost-actor-not-in-ledger" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });
});

describe("assertGrantedCommand fail-closed does not flip open for legitimate run-scoped-grant-free flows", () => {
  test("permits orchestrator:run with no --run and no --actor, the fresh-capsule bootstrap case", () => {
    expect(() => assertGrantedCommand(spec("orchestrator:run"), {})).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("orchestrator:run"), { repo: ".", prompt: "hi" }),
    ).not.toThrow();
  });

  test("permits orchestrator:run against an unresolvable --run with no --actor", () => {
    const flags: Flags = { run: "/nonexistent/probe-run" };
    expect(() => assertGrantedCommand(spec("orchestrator:run"), flags)).not.toThrow();
  });

  test("permits structurally identity-free read-only commands with a --run but no identity flag", async () => {
    const { run } = await emptyGrantRun("fail-closed-readonly-");
    expect(() => assertGrantedCommand(spec("queue:wave"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("plan:status"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:next"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:list"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("report"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("report:dag"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("run:status"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("agent:list"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("branch:status"), { run })).not.toThrow();
    expect(() => assertGrantedCommand(spec("summary:view"), { run })).not.toThrow();
  });

  test("still denies a command that declares an identity flag even when it goes unsupplied against a real run", async () => {
    const { run } = await emptyGrantRun("fail-closed-identity-declared-");
    expect(() => assertGrantedCommand(spec("task:submit"), { run })).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });
});

describe("assertGrantedCommand hole 5: revocation is honoured, not theatre", () => {
  test("denies a released agent outright, distinct from an unregistered ghost", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-released-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "probe-released",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
          released_at: new Date().toISOString(),
          release_reason: "test-teardown",
        },
      ];
    });

    const flags: Flags = { run, agent: "probe-released" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("a released agent stays denied even for a command it would otherwise hold a valid role for", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-role-valid-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "probe-released-2",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
        },
      ];
    });

    const flags: Flags = { run, actor: "probe-released-2" };
    expect(() => assertGrantedCommand(spec("task:claim"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("a released coordinator cannot invoke agent:register despite grant genesis being bootstrap-exempt", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-register-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "released-coordinator",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
        },
      ];
    });

    const flags: Flags = {
      run,
      actor: "released-coordinator",
      "parent-agent": "released-coordinator",
      role: "implementer",
      agent: "impl-should-not-exist",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("an active grant is unaffected by the status filter", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-active-control-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "active-implementer",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, agent: "active-implementer" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).not.toThrow();
  });
});

describe("assertGrantedCommand end to end: role contract is enforced once a grant resolves", () => {
  test("a granted actor whose role contract allows the command is permitted", async () => {
    const { run } = await emptyGrantRun("fail-closed-role-allowed-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "impl-permitted",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, agent: "impl-permitted" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).not.toThrow();
  });

  test("a granted actor whose role contract does not allow the command is denied, naming actor, command and reason", async () => {
    const { run } = await emptyGrantRun("fail-closed-role-denied-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "val-denied",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, validator: "val-denied" };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("task:submit"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("val-denied");
    expect(message).toContain("task:submit");
    expect(message).toContain("may not invoke");
  });

  test("an unresolved role denies rather than silently skipping the contract check", async () => {
    const { run } = await emptyGrantRun("fail-closed-unresolved-role-");
    const flags: Flags = { run, agent: "no-such-agent-in-ledger" };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("task:submit"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("no-such-agent-in-ledger");
    expect(message).toContain("task:submit");
    expect(message).toContain("no grant");
  });
});

describe("assertGrantedCommand: run-optional identity-free commands permit the no-flag invocation", () => {
  test("permits report, run:status/status, branch:status, memory:query, queue:wave and plan:status with zero flags", () => {
    expect(() => assertGrantedCommand(spec("report"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("run:status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("branch:status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("memory:query"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:wave"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("plan:status"), {})).not.toThrow();
  });

  test("permits watchdog's cross-run/cross-generation commands with zero flags", () => {
    expect(() => assertGrantedCommand(spec("watchdog:cleanup"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("watchdog:phase-cleanup"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("watchdog:status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("watchdog:verify"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("watchdog:probe"), {})).not.toThrow();
  });

  test("permits dag:trace with zero flags despite declaring an --actor display filter", () => {
    expect(() => assertGrantedCommand(spec("dag:trace"), {})).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("dag:trace"), { run: "/nonexistent/probe-run", actor: "impl-7" }),
    ).not.toThrow();
  });
});

describe("assertGrantedCommand: pre-compile plan construction runs before any grant exists", () => {
  test("permits plan:add, plan:compile and plan:brainstorm for an unregistered planner in a fresh capsule", async () => {
    const { run } = await emptyGrantRun("fail-closed-plan-construction-permit-");
    expect(() =>
      assertGrantedCommand(spec("plan:add"), {
        run,
        id: "task-1",
        label: "First task",
        actor: "planner",
      }),
    ).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("plan:compile"), { run, actor: "planner" }),
    ).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { run, actor: "planner" }),
    ).not.toThrow();
  });

  test("a released planner still denies plan:add: the pre-compile exemption never overrides an active revocation", async () => {
    const { run } = await emptyGrantRun("fail-closed-plan-construction-revoked-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "released-planner",
          role: "planner",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
        },
      ];
    });
    const flags: Flags = {
      run,
      id: "task-1",
      label: "First task",
      actor: "released-planner",
    };
    expect(() => assertGrantedCommand(spec("plan:add"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });
});

describe("assertGrantedCommand: the false-positive repair does not widen into a bypass", () => {
  test("still denies task:claim for a never-registered actor, even with --run supplied", async () => {
    const { run } = await emptyGrantRun("fail-closed-task-claim-ghost-");
    const flags: Flags = { run, task: "task-1", agent: "worker-1", role: "implementer" };
    expect(() => assertGrantedCommand(spec("task:claim"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS and GRANT_BOOTSTRAP_ALLOWLIST hold only the intended pre-compile commands, not general task-lifecycle authority", () => {
    expect([...PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS].sort()).toEqual(
      ["plan:add", "plan:brainstorm", "plan:compile", "plan:enhance"].sort(),
    );
    for (const authorityBearingCommand of [
      "task:claim",
      "task:submit",
      "task:heartbeat",
      "run:complete",
      "authority:decide",
    ]) {
      expect(GRANT_BOOTSTRAP_ALLOWLIST.has(authorityBearingCommand)).toBe(false);
      expect(requiresActingIdentity(spec(authorityBearingCommand))).toBe(true);
    }
  });

  test("a synthetic authority-bearing command shaped like the exempt ones is still denied by name, not by shape", () => {
    const syntheticSpec: CommandSpec = {
      ...spec("task:claim"),
      name: "task:not-actually-exempt",
      aliases: [],
    };
    expect(() => assertGrantedCommand(syntheticSpec, {})).toThrow(
      "not on the grant bootstrap allowlist",
    );
    expect(() => assertGrantedCommand(syntheticSpec, { run: "/nonexistent/probe-run" })).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });
});
