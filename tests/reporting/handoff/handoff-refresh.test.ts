import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  refreshHandoff,
  refreshHandoffOnEscalation,
} from "../../../olt/scripts/src/reporting/handoff.ts";
import { taskSubmitCommand } from "../../../olt/scripts/src/cli/commands/task-claim.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { workflowPort } from "../../../olt/scripts/src/integration/store-ports.ts";
import {
  orchestratorSuperviseCommand,
  orchestratorTickCommand,
} from "../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { spyOn } from "bun:test";
import { RunSupervisor } from "../../../olt/scripts/src/orchestrator/supervisor.ts";
import * as observeChanges from "../../../olt/scripts/src/workflow/submission/observe-changes.ts";
import * as quotaLifecycle from "../../../olt/scripts/src/workflow/lifecycle/quota-lifecycle.ts";
import * as hostTelemetryProbe from "../../../olt/scripts/src/cli/host-telemetry-probe.ts";
import * as runLock from "../../../olt/scripts/src/platform/process/run-lock.ts";
import * as durableWrite from "../../../olt/scripts/src/core/durable-write.ts";
import {
  cleanupVirtualReportingFS,
  getVirtualReportingFS,
  setupVirtualReportingFS,
  tempDir,
} from "../fixture.ts";

const TASK_ID = "task-core";
const CHANGED_FILE = "tests/core/probe-target.ts";

function setupHandoffRun(name: string): { repo: string; run: string } {
  const vfs = getVirtualReportingFS();
  const repo = tempDir(name);
  vfs.writeFileSync(join(repo, "package.json"), "{}");
  vfs.writeFileSync(
    join(repo, "harness.config.json"),
    JSON.stringify({ min_adversarial_probes: 1 }),
  );
  vfs.mkdirSync(join(repo, "tests/core"), { recursive: true });
  vfs.writeFileSync(join(repo, CHANGED_FILE), "export const probed = true;\n");
  vfs.writeFileSync(join(repo, "gate-core.ts"), "console.log('gate-core');\n");

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
    state.packets = {
      "packet-core": {
        status: "published",
        task_id: TASK_ID,
        role: "implementer",
        agent_id: "worker-1",
        attempt: 1,
      },
    };
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
    spyOn(RunSupervisor.prototype, "run").mockImplementation(async function () {
      return {
        stopReason: "single_tick",
        ticks: 1,
        lastTick: {
          reclaimed: [],
          escalatedNow: [],
          changesRequested: [],
          dispatchable: [],
          backingOff: [],
          occupied: 0,
          maxParallel: 1,
        },
        report: {
          generatedAt: new Date().toISOString(),
          completed: [],
          escalated: [],
          changesRequested: [],
          deadAgentsReclaimed: 0,
          retries: [],
          runSpanMs: 0,
          totalBackoffMs: 0,
          needsHuman: [],
          occupiedAtReport: 0,
          ceilings: { maxParallel: 1, gateMaxParallel: 1 },
        },
      };
    });
    spyOn(observeChanges, "observeChangedFiles").mockReturnValue([CHANGED_FILE]);
    spyOn(quotaLifecycle, "probeLiveQuotaTelemetry").mockResolvedValue({
      report: {} as any,
      evaluation: { isTriggered: false, lowestPercentage: 100, status: "nominal" } as any,
      activeHost: "generic",
      quotaBadge: "[██████] 100%",
      lowestQuotaPercentage: 100,
      isTriggered: false,
      status: "nominal",
    });
    spyOn(runLock, "withRunLock").mockImplementation((_root, op) => op());
    spyOn(durableWrite, "fsyncDirectory").mockImplementation(() => {});
    spyOn(hostTelemetryProbe, "probeAgentTelemetry").mockReturnValue({});
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("task:submit refreshes handoff.md and returns handoff_path", async () => {
    const { repo, run } = setupHandoffRun("handoff-submit");
    const port = workflowPort(run);
    const claim = claimTask(port, TASK_ID, "worker-1", "implementer");
    const token = claim.token;

    const vfs = getVirtualReportingFS();
    vfs.writeFileSync(
      join(repo, CHANGED_FILE),
      "export const probed = true;\nexport const implemented = true;\n",
    );
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
    expect(vfs.existsSync(submit.handoff_path as string)).toBe(true);
    const handoffContent = vfs.readFileSync(submit.handoff_path as string, "utf8");
    expect(handoffContent).toContain("# Harness handoff");
  });

  test("orchestrator:supervise / orchestratorTickCommand refreshes handoff.md and returns handoff_path", async () => {
    const vfs = getVirtualReportingFS();
    const { run } = setupHandoffRun("handoff-supervise");
    const supervise = await orchestratorSuperviseCommand({
      run,
      actor: "coordinator",
    });
    expect(typeof supervise.handoff_path).toBe("string");
    expect(vfs.existsSync(supervise.handoff_path as string)).toBe(true);
    const handoffContent = vfs.readFileSync(supervise.handoff_path as string, "utf8");
    expect(handoffContent).toContain("# Harness handoff");

    const tickResult = await orchestratorTickCommand({
      run,
      actor: "coordinator",
    });
    expect(typeof tickResult.handoff_path).toBe("string");
    expect(vfs.existsSync(tickResult.handoff_path as string)).toBe(true);
  });
});
