import { describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  assertGrantedCommand as assertRawGrantedCommand,
  assertSpawnAuthorized,
  type AuthenticatedCaller,
} from "../../../olt/scripts/src/packets/command-authority.ts";
import {
  GRANT_BOOTSTRAP_ALLOWLIST,
  PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS,
  requiresActingIdentity,
} from "../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import type { AgentRole } from "../../../olt/scripts/src/core/contracts/packets.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { emptyGrantRun } from "./grant-run-fixture.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  registerSessionGrant,
  revokeSessionGrant,
} from "../../../olt/scripts/src/authority/session-registry.ts";
import { loadDagSnapshot } from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

function testCaller(specification: CommandSpec, flags: Flags): AuthenticatedCaller | undefined {
  const callerFlag = ["actor", "validator", "critic", "agent"].find((name) => {
    if (
      (specification.name === "agent:register" ||
        specification.name === "agent:report" ||
        specification.name === "agent:release") &&
      name === "agent"
    ) {
      return false;
    }
    return typeof flags[name] === "string" && flags[name].trim() !== "";
  });
  if (callerFlag === undefined) return undefined;
  return { actor: flags[callerFlag] as string, role: "test", verified: true };
}

function assertGrantedCommand(specification: CommandSpec, flags: Flags): void {
  assertRawGrantedCommand(specification, flags, testCaller(specification, flags));
}

function installMetaAuditGrant(
  run: string,
  id: string,
  role: string,
  status: "active" | "released" = "active",
): void {
  transact(run, "test-setup", "grant-agent", {}, (draft) => {
    draft.agents = [
      {
        id,
        role,
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: new Date().toISOString(),
        status,
      },
    ];
  });
}

describe("meta-audit execute authority", () => {
  test("denies ghost, released, and implementer actors through execute", async () => {
    for (const [id, role, status] of [
      ["ghost", undefined, undefined],
      ["released", "coordinator", "released"],
      ["worker", "implementer", "active"],
    ] as const) {
      const { run } = await emptyGrantRun(`meta-audit-${id}-`);
      if (role !== undefined && status !== undefined) installMetaAuditGrant(run, id, role, status);
      await expect(
        execute(["meta-audit", "--run", run, "--actor", id, "--inject"]),
      ).rejects.toThrow();
    }
  });

  test("accepts active coordinator actor and never treats --agent filter as actor", async () => {
    const { run } = await emptyGrantRun("meta-audit-coordinator-");
    installMetaAuditGrant(run, "coordinator", "coordinator");
    registerSessionGrant({ runRoot: run, agentId: "coordinator", role: "coordinator" });
    const result = await execute([
      "meta-audit",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--agent",
      "victim",
    ]);
    expect(result.run_root).toBe(run);
    revokeSessionGrant({
      runRoot: run,
      agentId: "coordinator",
      pid: process.pid,
      ppid: process.ppid,
    });
    await expect(
      execute(["meta-audit", "--run", run, "--agent", "victim", "--inject"]),
    ).rejects.toThrow("--actor is required");
  });

  test("accepts an active meta-auditor actor through execute", async () => {
    const { run } = await emptyGrantRun("meta-audit-meta-auditor-");
    installMetaAuditGrant(run, "meta-auditor", "meta-auditor");
    registerSessionGrant({ runRoot: run, agentId: "meta-auditor", role: "meta-auditor" });
    const result = await execute(["meta-audit", "--run", run, "--actor", "meta-auditor"]);
    expect(result.run_root).toBe(run);
  });

  test("auto-fills a verified durable coordinator session through execute", async () => {
    const { run } = await emptyGrantRun("meta-audit-session-");
    installMetaAuditGrant(run, "session-coordinator", "coordinator");
    registerSessionGrant({ runRoot: run, agentId: "session-coordinator", role: "coordinator" });
    const result = await execute(["meta-audit", "--run", run]);
    expect(result.run_root).toBe(run);
  });

  test("does not auto-fill a meta-audit actor from fake PID or PPID session records", async () => {
    const { run } = await emptyGrantRun("meta-audit-fake-process-");
    installMetaAuditGrant(run, "fake-process-coordinator", "coordinator");
    registerSessionGrant({
      runRoot: run,
      agentId: "fake-process-coordinator",
      role: "coordinator",
      pid: 812345,
      ppid: 812344,
    });

    await expect(execute(["meta-audit", "--run", run, "--inject"])).rejects.toThrow(
      "--actor is required",
    );
  });
});

describe("quota lifecycle execute authority", () => {
  test("requires a run and a verified actor before any quota snapshot can be written", async () => {
    const { repo, run } = await emptyGrantRun("quota-identity-required-");
    const snapshot = join(repo, ".olt", "quota-dag-snapshot.json");
    await expect(execute(["quota:freeze", "--run", run, "--force"])).rejects.toThrow(
      "--actor is required",
    );
    await expect(execute(["quota:freeze", "--actor", "ghost", "--force"])).rejects.toThrow(
      "--run is required",
    );
    expect(existsSync(snapshot)).toBe(false);
  });

  test("denies ghost, released, and implementer actors even with --force", async () => {
    for (const [id, role, status] of [
      ["ghost", undefined, undefined],
      ["released", "mind", "released"],
      ["worker", "implementer", "active"],
    ] as const) {
      const { repo, run } = await emptyGrantRun(`quota-denied-${id}-`);
      if (role !== undefined && status !== undefined) installMetaAuditGrant(run, id, role, status);
      await expect(
        execute(["quota:freeze", "--run", run, "--actor", id, "--force"]),
      ).rejects.toThrow();
      expect(existsSync(join(repo, ".olt", "quota-dag-snapshot.json"))).toBe(false);
    }
  });

  test("permits only active mind and orchestrator grants to freeze and resume the bound run", async () => {
    const { repo, run } = await emptyGrantRun("quota-allowed-");
    const initialized = spawnSync("git", ["init", "--quiet", repo]);
    if (initialized.status !== 0)
      throw new Error("could not initialize quota authority test repository");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });
    const frozen = await execute(["quota:freeze", "--run", run, "--actor", "mind", "--force"]);
    expect(frozen.status).toBe("frozen");
    expect(loadDagSnapshot(repo)?.runRoot).toBe(run);
    installMetaAuditGrant(run, "orchestrator", "orchestrator");
    registerSessionGrant({ runRoot: run, agentId: "orchestrator", role: "orchestrator" });
    const resumed = await execute([
      "quota:resume",
      "--run",
      run,
      "--actor",
      "orchestrator",
      "--force",
    ]);
    expect(resumed.status).toBe("resumed");
    expect(loadDagSnapshot(repo)?.status).toBe("resumed");
  });
});

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
    expect(() => assertGrantedCommand(spec("mind:queue:drain"), {})).toThrow("authority-run");
    expect(() => assertGrantedCommand(spec("mind:queue:seal"), {})).toThrow("authority-run");
    expect(() => assertGrantedCommand(spec("mind:queue:clean"), {})).toThrow("authority-run");
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

describe("governed mutation authority", () => {
  test("denies every governed mutator without a session using the same fail-closed error", async () => {
    const { run } = await emptyGrantRun("governed-mutator-no-session-");
    const invocations = [
      ["mind:queue:drain", "--authority-run", run],
      ["mind:queue:seal", "--authority-run", run, "--id", "feedback-1", "--resolution", "done"],
      ["mind:queue:clean", "--authority-run", run],
      ["watchdog:cleanup", "--authority-run", run, "--run", run],
      ["watchdog:phase-cleanup", "--authority-run", run, "--run", run, "--phase", "plan"],
    ];
    const messages: string[] = [];
    for (const argv of invocations) {
      try {
        await execute(argv);
      } catch (error) {
        if (!(error instanceof HarnessError)) throw error;
        messages.push(error.message);
      }
    }
    expect(messages).toEqual([
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
    ]);
  });

  test("keeps queue inspection and intake context-free", async () => {
    const { repo } = await emptyGrantRun("queue-context-free-");
    const queueFile = join(repo, ".olt", "context-free-backlog.jsonl");
    await expect(execute(["mind:queue:list", "--queue-file", queueFile])).resolves.toBeDefined();
    await expect(
      execute([
        "mind:queue:add",
        "--title",
        "External intake",
        "--content",
        "Intake remains context-free",
        "--queue-file",
        queueFile,
      ]),
    ).resolves.toMatchObject({
      item: { title: "External intake" },
    });
  });

  test("permits only an active Mind and binds mutation paths to its authority repository", async () => {
    const { repo, run } = await emptyGrantRun("governed-mutator-mind-");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const queueFile = join(repo, ".olt", "governed-backlog.jsonl");
    const result = await execute([
      "mind:queue:drain",
      "--authority-run",
      run,
      "--actor",
      "mind",
      "--queue-file",
      queueFile,
    ]);
    expect(result.drainedCount).toBe(0);

    const outside = join(repo, "..", "outside-governed-backlog.jsonl");
    await expect(
      execute([
        "mind:queue:drain",
        "--authority-run",
        run,
        "--actor",
        "mind",
        "--queue-file",
        outside,
      ]),
    ).rejects.toMatchObject({ code: "PATH_SAFETY" });
    expect(existsSync(outside)).toBe(false);
  });

  test("rejects the direct-handler completed-file alias before an authorized clean can mutate queue state", async () => {
    const { repo, run } = await emptyGrantRun("governed-clean-unknown-completed-file-");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const oltDirectory = join(repo, ".olt");
    const queueFile = join(oltDirectory, "backlog.jsonl");
    const archiveFile = join(oltDirectory, "completed-tasks.jsonl");
    const outsideArchive = join(repo, "..", "outside-clean-completed-tasks.jsonl");
    const queueBytes =
      '{"id":"feedback-1","timestamp":"2026-01-01T00:00:00.000Z","priority":"NORMAL","status":"COMPLETED","category":"GENERAL","title":"Completed feedback","content":"must remain queued"}\n';
    const archiveBytes = "canonical archive sentinel\n";
    const outsideBytes = "outside archive sentinel\n";
    await mkdir(oltDirectory, { recursive: true });
    await writeFile(queueFile, queueBytes);
    await writeFile(archiveFile, archiveBytes);
    await writeFile(outsideArchive, outsideBytes);

    await expect(
      execute(["mind:queue:clean", "--authority-run", run, "--completed-file", outsideArchive]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(readFile(queueFile, "utf8")).resolves.toBe(queueBytes);
    await expect(readFile(archiveFile, "utf8")).resolves.toBe(archiveBytes);
    await expect(readFile(outsideArchive, "utf8")).resolves.toBe(outsideBytes);
  });

  test("rejects an archive path that traverses an in-repository symlink before clean can mutate outside state", async () => {
    const { repo, run } = await emptyGrantRun("governed-clean-symlink-archive-");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const oltDirectory = join(repo, ".olt");
    const queueFile = join(oltDirectory, "backlog.jsonl");
    const outsideDirectory = join(repo, "..", "outside-archive");
    const outsideArchive = join(outsideDirectory, "completed-tasks.jsonl");
    const linkedDirectory = join(oltDirectory, "outside-archive-link");
    const linkedArchive = join(linkedDirectory, "completed-tasks.jsonl");
    const queueBytes =
      '{"id":"feedback-1","timestamp":"2026-01-01T00:00:00.000Z","priority":"NORMAL","status":"COMPLETED","category":"GENERAL","title":"Completed feedback","content":"must remain queued"}\n';
    const outsideBytes = "outside archive sentinel\n";
    await mkdir(oltDirectory, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(queueFile, queueBytes);
    await writeFile(outsideArchive, outsideBytes);
    await symlink(outsideDirectory, linkedDirectory);

    let thrown: unknown;
    try {
      await execute([
        "mind:queue:clean",
        "--authority-run",
        run,
        "--actor",
        "mind",
        "--archive-file",
        linkedArchive,
      ]);
    } catch (error) {
      thrown = error;
    }

    await expect(readFile(outsideArchive, "utf8")).resolves.toBe(outsideBytes);
    await expect(readFile(queueFile, "utf8")).resolves.toBe(queueBytes);
    expect(thrown).toMatchObject({ code: "PATH_SAFETY" });
  });

  test("denies non-Mind, released, and mismatched authority-run callers", async () => {
    for (const [id, role, status] of [
      ["implementer", "implementer", "active"],
      ["validator", "validator", "active"],
      ["meta-auditor", "meta-auditor", "active"],
      ["released-mind", "mind", "released"],
    ] as const) {
      const { run } = await emptyGrantRun(`governed-mutator-${id}-`);
      installMetaAuditGrant(run, id, role, status);
      expect(() =>
        assertRawGrantedCommand(
          spec("mind:queue:drain"),
          { "authority-run": run, actor: id },
          { actor: id, role, verified: true },
        ),
      ).toThrow();
    }

    const { repo, run } = await emptyGrantRun("governed-mutator-mismatch-");
    const otherRun = initRun(repo, "second-run", new TextEncoder().encode("prompt"), "file", true);
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });
    await expect(
      execute(["watchdog:cleanup", "--authority-run", otherRun, "--run", run, "--actor", "mind"]),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILURE" });
  });
});

describe("assertGrantedCommand hole 2: no acting identity resolves", () => {
  test("denies a non-allowlisted command with --run but no identity flag", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "verified caller session",
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

  test("permits plan:brainstorm without --run only for the prompt-only in-memory form", () => {
    expect(() => assertGrantedCommand(spec("plan:brainstorm"), {})).toThrow(
      "not on the grant bootstrap allowlist",
    );
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { prompt: "in-memory prompt" }),
    ).not.toThrow();
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

  test("denies agent:register against an unreadable capsule because genesis requires a readable empty ledger", async () => {
    const { repo } = await emptyGrantRun("fail-closed-hole3-permit-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    const flags: Flags = { run: brokenRoot, actor: "first-orchestrator" };
    expect(() => assertRawGrantedCommand(spec("agent:register"), flags)).toThrow(
      "first-grant genesis requires a readable empty agent ledger",
    );
  });

  test("permits plan:brainstorm without an agent grant only for a readable capsule", async () => {
    const { run } = await emptyGrantRun("fail-closed-brainstorm-empty-grant-");
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { run, actor: "planner-no-grant" }),
    ).not.toThrow();
  });

  test("denies plan:brainstorm against an unreadable capsule even though it is grant-bootstrap exempt", async () => {
    const { repo } = await emptyGrantRun("fail-closed-brainstorm-unreadable-");
    const brokenRoot = join(repo, "not-a-capsule");
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, "state.json"), "{}");
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { run: brokenRoot, actor: "planner-no-grant" }),
    ).toThrow("not on the grant bootstrap allowlist for missing capsules");
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
      "verified caller session",
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

  test("requires authority-run for watchdog mutation commands while keeping inspection context-free", () => {
    expect(() => assertGrantedCommand(spec("watchdog:cleanup"), {})).toThrow("authority-run");
    expect(() => assertGrantedCommand(spec("watchdog:phase-cleanup"), {})).toThrow("authority-run");
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
      "verified caller session",
    );
  });
});

describe("assertGrantedCommand hole 6: agent:register --parent-agent binding fails open when the actor is absent", () => {
  async function seedActiveMind(run: string): Promise<void> {
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });
  }

  test("denies minting a Tier 1 orchestrator under a named --parent-agent when no acting identity is supplied at all", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-no-actor-");
    await seedActiveMind(run);

    const flags: Flags = {
      run,
      agent: "orch-stolen",
      role: "orchestrator",
      host: "claude-code",
      "parent-agent": "mind-1",
    };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("agent:register"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const error = thrown as HarnessError;
    expect(error.code).toBe("AUTHENTICATION_FAILURE");
    expect(error.message).toContain("mind-1");
    expect(error.message).not.toContain("Agent Granted");
  });

  test("denies an unverified explicit --actor instead of treating its value as parent proof", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-wrong-actor-");
    await seedActiveMind(run);

    const flags: Flags = {
      run,
      agent: "orch-x",
      role: "orchestrator",
      host: "claude-code",
      "parent-agent": "mind-1",
      actor: "orch-stolen",
    };
    let thrown: unknown;
    try {
      assertRawGrantedCommand(spec("agent:register"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    expect((thrown as HarnessError).code).toBe("AUTHENTICATION_FAILURE");
  });

  test("permits the same registration once --actor proves the caller really is the named parent", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-legit-actor-");
    await seedActiveMind(run);

    const flags: Flags = {
      run,
      agent: "orch-legit",
      role: "orchestrator",
      host: "claude-code",
      "parent-agent": "mind-1",
      actor: "mind-1",
    };
    expect(() =>
      assertRawGrantedCommand(spec("agent:register"), flags, {
        actor: "mind-1",
        role: "mind",
        verified: true,
      }),
    ).not.toThrow();
  });

  test("omitting the actor is denied identically whichever acting-identity flag would have carried it", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-no-actor-variants-");
    await seedActiveMind(run);

    for (const flags of [
      {
        run,
        agent: "orch-stolen-a",
        role: "orchestrator",
        host: "claude-code",
        "parent-agent": "mind-1",
      },
      {
        run,
        agent: "orch-stolen-b",
        role: "orchestrator",
        host: "claude-code",
        "parent-agent": "mind-1",
        validator: undefined,
      },
    ] satisfies Flags[]) {
      let thrown: unknown;
      try {
        assertGrantedCommand(spec("agent:register"), flags);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HarnessError);
      expect((thrown as HarnessError).code).toBe("AUTHENTICATION_FAILURE");
    }
  });
});

describe("assertSpawnAuthorized: an unreadable declared-spawn role contract denies rather than waives the allowlist", () => {
  test("denies dispatch when the parent role's contract file cannot be loaded from disk", () => {
    const unregisteredParentRole = "orchestrator-ghost-contract" as unknown as AgentRole;
    let thrown: unknown;
    try {
      assertSpawnAuthorized(unregisteredParentRole, "coordinator");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const error = thrown as HarnessError;
    expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    expect(error.message).toContain("could not be loaded");
    expect(error.message).toContain("does not waive the declared-spawn allowlist");
  });

  test("a readable contract that declares the child role still passes, as a control", () => {
    expect(() => assertSpawnAuthorized("orchestrator", "coordinator")).not.toThrow();
  });
});
