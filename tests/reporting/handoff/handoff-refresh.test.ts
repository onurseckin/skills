import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  refreshHandoff,
  refreshHandoffOnEscalation,
} from "../../../olt/scripts/src/reporting/handoff.ts";
import {
  taskClaimCommand,
  taskSubmitCommand,
} from "../../../olt/scripts/src/cli/commands/task-claim.ts";
import {
  orchestratorSuperviseCommand,
  orchestratorTickCommand,
} from "../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

const TASK_ID = "task-core";
const CHANGED_FILE = "tests/core/probe-target.ts";

function setupHandoffRun(name: string): { repo: string; run: string } {
  const repo = tempDir(name);
  fs.mkdirSync(join(repo, ".git"), { recursive: true });
  fs.writeFileSync(join(repo, "package.json"), "{}");
  fs.writeFileSync(
    join(repo, "harness.config.json"),
    JSON.stringify({ min_adversarial_probes: 1 }),
  );
  fs.mkdirSync(join(repo, "tests/core"), { recursive: true });
  fs.writeFileSync(join(repo, CHANGED_FILE), "export const probed = true;\n");
  fs.writeFileSync(join(repo, "gate-core.ts"), "console.log('gate-core');\n");

  const run = initRun(repo, name, new TextEncoder().encode("Prompt"), "file", true);
  transact(run, "planner", "plan-applied", {}, (state) => {
    state.graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        {
          id: TASK_ID,
          requirement_ids: ["R-1"],
          read_scope: [],
          write_scope: ["tests/core"],
          type: "task",
        },
      ],
      edges: [],
      gates: [
        {
          id: "gate-1",
          scope: "task",
          cwd: ".",
          command: ["bun", "gate-core.ts"],
          requirement_ids: ["R-1"],
          mandatory: true,
        },
      ],
    };
    state.requirements = {
      requirements: [{ id: "R-1", disposition: "actionable", status: "planned", evidence: [] }],
    };
    state.tasks = {
      [TASK_ID]: {
        id: TASK_ID,
        status: "ready",
        requirement_ids: ["R-1"],
        dependencies: [],
        write_scope: ["tests/core"],
        attempts: [],
        history: [],
        repair_round: 0,
      },
    };
  });

  return { repo, run };
}

export const handoffRefreshSuiteName = "refreshHandoff";

describe(handoffRefreshSuiteName, () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("a run that cannot be rendered yields undefined instead of throwing", () => {
    expect(refreshHandoff("/nonexistent/run/root/for/sure")).toBeUndefined();
  });
});

describe("refreshHandoffOnEscalation", () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("only escalation triggers a refresh attempt", () => {
    expect(refreshHandoffOnEscalation("/nonexistent/run/root", "running")).toBeUndefined();
  });

  test("an escalated status that fails to refresh still yields undefined, not a throw", () => {
    expect(
      refreshHandoffOnEscalation("/nonexistent/run/root/for/sure", "escalated"),
    ).toBeUndefined();
  });
});

describe("handoff refresh at lifecycle boundaries", () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("task:submit refreshes handoff.md and returns handoff_path", async () => {
    const { repo, run } = setupHandoffRun("handoff-submit");
    const claim = await taskClaimCommand({
      run,
      task: TASK_ID,
      agent: "worker-1",
      role: "implementer",
    });
    const token = claim.token as string;

    fs.writeFileSync(
      join(repo, CHANGED_FILE),
      "export const probed = true;\nexport const implemented = true;\n",
    );
    transact(run, "worker-1", "command-recorded", {}, (state) => {
      state.commands = {
        "C-1": {
          id: "C-1",
          task_id: TASK_ID,
          actor: "worker-1",
          status: "succeeded",
          exit_code: 0,
          fingerprint: "fp-1",
          logs: {
            stdout: { path: "logs/stdout.txt", sha256: "0".repeat(64) },
          },
        },
      };
    });
    const submit = await taskSubmitCommand({
      run,
      task: TASK_ID,
      agent: "worker-1",
      token,
      summary: "completed probe implementation",
      "files-changed": CHANGED_FILE,
      evidence: "C-1",
    });
    expect(typeof submit.handoff_path).toBe("string");
    expect(fs.existsSync(submit.handoff_path as string)).toBe(true);
    const handoffContent = fs.readFileSync(submit.handoff_path as string, "utf8");
    expect(handoffContent).toContain("# Harness handoff");
  });

  test("orchestrator:supervise / orchestratorTickCommand refreshes handoff.md and returns handoff_path", async () => {
    const { run } = setupHandoffRun("handoff-supervise");
    const supervise = await orchestratorSuperviseCommand({
      run,
      actor: "coordinator",
    });
    expect(typeof supervise.handoff_path).toBe("string");
    expect(fs.existsSync(supervise.handoff_path as string)).toBe(true);
    const handoffContent = fs.readFileSync(supervise.handoff_path as string, "utf8");
    expect(handoffContent).toContain("# Harness handoff");

    const tickResult = await orchestratorTickCommand({
      run,
      actor: "coordinator",
    });
    expect(typeof tickResult.handoff_path).toBe("string");
    expect(fs.existsSync(tickResult.handoff_path as string)).toBe(true);
  });
});
