import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { metaAuditCommand } from "../../../../../olt/scripts/src/cli/commands/meta-audit.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../../../shared/fixtures/scratch-root.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { registerSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const PREEXISTING_BACKLOG_LINE =
  '{"id":"existing-remediation","timestamp":"2026-08-26T00:00:00.000Z","priority":"LOW","status":"PENDING","category":"CORE_ENGINE","title":"Existing remediation","content":"Keep this sentinel","candidate_id":null,"resolution_note":null,"processed_at":null}\n';

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function setupInjectableMetaAuditRun(
  label: string,
  actorId: string,
  role: string,
): {
  readonly run: string;
  readonly backlogPath: string;
} {
  const repository = scratchRoot(import.meta.path, label);
  const run = initRun(
    repository,
    "meta-audit-authority",
    new TextEncoder().encode("Audit authority test"),
    "file",
    true,
  );
  transact(run, "test-setup", "seed-meta-audit-authority", {}, (draft) => {
    draft.agents = [
      {
        id: actorId,
        role,
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: "2026-08-26T00:00:00.000Z",
        status: "active",
      },
      {
        id: "released-implementer",
        role: "implementer",
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: "2026-08-26T00:00:00.000Z",
        status: "released",
      },
    ];
    draft.tasks = {
      "ghost-lease-task": {
        id: "ghost-lease-task",
        status: "leased",
        lease: { agent_id: "released-implementer" },
      },
    };
  });
  const backlogPath = join(run, ".olt", "backlog.jsonl");
  mkdirSync(join(run, ".olt"), { recursive: true });
  writeFileSync(backlogPath, PREEXISTING_BACKLOG_LINE, "utf8");
  return { run, backlogPath };
}

function expectOneValidRemediationAppend(backlogPath: string, before: string): void {
  const after = readFileSync(backlogPath, "utf8");
  expect(after.startsWith(before)).toBe(true);
  const appendedLines = after.slice(before.length).trim().split("\n");
  expect(appendedLines).toHaveLength(1);
  const appended: unknown = JSON.parse(appendedLines[0]!);
  expect(appended).toMatchObject({
    status: "PENDING",
    metadata: { root_cause: "GHOST_LEASE" },
  });
}

describe("CLI meta-audit command execution & authority", () => {
  test("rejects unrecognized flag", async () => {
    let thrown: unknown;
    try {
      await metaAuditCommand({ run: "/tmp/fake", "invalid-flag": "val" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    expect((thrown as HarnessError).code).toBe("INVALID_ARGUMENT");
  });

  test("rejects invalid --format", async () => {
    let thrown: unknown;
    try {
      await metaAuditCommand({ run: "/tmp/fake", format: "xml" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    expect((thrown as HarnessError).code).toBe("INVALID_ARGUMENT");
    expect((thrown as HarnessError).message).toContain("invalid --format 'xml'");
  });

  test("executes on a real run capsule with markdown output", async () => {
    const scratch = scratchRoot(import.meta.path, "meta-audit-real-run");
    const promptPath = join(scratch, "prompt.txt");
    await writeFile(promptPath, "Test prompt for meta-audit execution");

    const init = await execute([
      "plan:init",
      "--repo",
      scratch,
      "--run",
      "audit-run-01",
      "--prompt-file",
      promptPath,
    ]);
    const runRoot = init.run_root as string;

    const result = await metaAuditCommand({ run: runRoot });
    expect(result.run_root).toBe(runRoot);
    expect(result.format).toBe("markdown");
    expect(result.report).toBeDefined();
    expect(result.report.summary).toBeDefined();
    expect(result.markdown).toContain("### Meta-Auditor Deep Behavioral Forensics Report");
  });

  test("supports --json and --format json flags", async () => {
    const scratch = scratchRoot(import.meta.path, "meta-audit-json-run");
    const promptPath = join(scratch, "prompt.txt");
    await writeFile(promptPath, "Test prompt for json format");

    const init = await execute([
      "plan:init",
      "--repo",
      scratch,
      "--run",
      "audit-run-json",
      "--prompt-file",
      promptPath,
    ]);
    const runRoot = init.run_root as string;

    const res1 = await metaAuditCommand({ run: runRoot, json: true });
    expect(res1.format).toBe("json");

    const res2 = await metaAuditCommand({ run: runRoot, format: "JSON" });
    expect(res2.format).toBe("json");
  });

  test("supports --agent, --verbose, and --inject flags", async () => {
    const scratch = scratchRoot(import.meta.path, "meta-audit-inject-run");
    const promptPath = join(scratch, "prompt.txt");
    await writeFile(promptPath, "Test prompt for agent and inject flags");

    const init = await execute([
      "plan:init",
      "--repo",
      scratch,
      "--run",
      "audit-run-inject",
      "--prompt-file",
      promptPath,
    ]);
    const runRoot = init.run_root as string;

    const result = await metaAuditCommand({
      run: runRoot,
      agent: "test-agent",
      verbose: true,
      inject: true,
    });

    expect(result.run_root).toBe(runRoot);
    expect(result.report.agent_filter).toBe("test-agent");
    expect(result.injection).toBeDefined();
  });

  test("invokes via execute CLI harness with meta-audit command", async () => {
    const scratch = scratchRoot(import.meta.path, "meta-audit-execute-harness");
    const promptPath = join(scratch, "prompt.txt");
    await writeFile(promptPath, "Test prompt for CLI harness execute");

    const init = await execute([
      "plan:init",
      "--repo",
      scratch,
      "--run",
      "audit-run-harness",
      "--prompt-file",
      promptPath,
    ]);
    const runRoot = init.run_root as string;

    await expect(execute(["meta-audit", "--run", runRoot, "--verbose"])).rejects.toThrow(
      "--actor is required",
    );
  });

  describe("meta-audit execute authority and backlog integrity", () => {
    test.each([
      ["no actor and no session", "coordinator", "coordinator", ["--inject"]],
      ["ghost actor", "coordinator", "coordinator", ["--actor", "ghost", "--inject"]],
      [
        "released actor",
        "coordinator",
        "coordinator",
        ["--actor", "released-implementer", "--inject"],
      ],
      ["implementer actor", "implementer", "implementer", ["--actor", "implementer", "--inject"]],
      [
        "agent filter substitution",
        "coordinator",
        "coordinator",
        ["--agent", "released-implementer", "--inject"],
      ],
    ])(
      "leaves preexisting backlog bytes unchanged for %s denial",
      async (_name, grantId, grantRole, argumentsAfterRun) => {
        const { run, backlogPath } = setupInjectableMetaAuditRun(
          `meta-audit-denial-${grantId}-${argumentsAfterRun.join("-")}`,
          grantId,
          grantRole,
        );
        const before = readFileSync(backlogPath, "utf8");

        await expect(execute(["meta-audit", "--run", run, ...argumentsAfterRun])).rejects.toThrow();

        expect(readFileSync(backlogPath, "utf8")).toBe(before);
      },
    );

    test.each([
      ["coordinator", "coordinator"],
      ["skill-auditor", "skill-auditor"],
    ] as const)(
      "appends exactly one valid remediation line for authorized %s actor",
      async (actorId, role) => {
        const { run, backlogPath } = setupInjectableMetaAuditRun(
          `meta-audit-authorized-${actorId}`,
          actorId,
          role,
        );
        registerSessionGrant({
          runRoot: run,
          agentId: actorId,
          role,
          pid: process.pid,
          ppid: process.ppid,
        });
        const before = readFileSync(backlogPath, "utf8");

        const result = await execute(["meta-audit", "--run", run, "--actor", actorId, "--inject"]);

        expect((result.injection as { injected_count: number }).injected_count).toBe(1);
        expectOneValidRemediationAppend(backlogPath, before);
      },
    );

    test("auto-fills a verified session actor and appends exactly one remediation line", async () => {
      const { run, backlogPath } = setupInjectableMetaAuditRun(
        "meta-audit-verified-session",
        "session-coordinator",
        "coordinator",
      );
      registerSessionGrant({
        runRoot: run,
        agentId: "session-coordinator",
        role: "coordinator",
        pid: process.pid,
        ppid: process.ppid,
      });
      const before = readFileSync(backlogPath, "utf8");

      const result = await execute(["meta-audit", "--run", run, "--inject"]);

      expect((result.injection as { injected_count: number }).injected_count).toBe(1);
      expectOneValidRemediationAppend(backlogPath, before);
    });
  });
});
