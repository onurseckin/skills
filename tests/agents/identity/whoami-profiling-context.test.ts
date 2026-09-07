import { describe, it, expect, beforeEach, afterEach, beforeAll } from "bun:test";
import { join } from "node:path";
import {
  identifyExecutionContext,
  MAIN_THREAD_ADVISORY,
  type HostProfile,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../olt/scripts/src/workflow/agents/grants.ts";
import {
  cleanupVirtualAgentsFS,
  getVirtualAgentsFS,
  scratchRoot,
  setupVirtualAgentsFS,
} from "../fixture.ts";

beforeAll(() => {
  setupVirtualAgentsFS();
  const run = createWhoamiRun("warmup");
  whoamiCommand({ run });
  cleanupVirtualAgentsFS();
});

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

function createWhoamiRun(label: string): string {
  const root = scratchRoot("whoami-test", label);
  const repo = join(root, "repo");
  getVirtualAgentsFS().mkdirSync(repo, { recursive: true });
  return initRun(repo, `run-${label}`, new TextEncoder().encode("whoami test"), "file", true);
}

function registerTestGrant(runRoot: string, agentId: string, role: string): void {
  registerAgentGrant({
    runRoot,
    agentId,
    role,
    parentAgentId: null,
    parentTaskId: null,
    host: "test-host",
    authority: { kind: "conditional_genesis" },
    maxAgents: 10,
    telemetry: {},
    now: new Date(),
  });
}

describe("Agent Whoami Profiling - Context & Actions", () => {
  describe("Compliance & Supervisory Auditing", () => {
    it("keeps an interactive main thread restrained without logging a passive defect", () => {
      const context = identifyExecutionContext({
        pid: 9999,
        ppid: 9998,
        isInteractiveMainThread: true,
        env: {
          INTERACTIVE_MAIN_THREAD: "1",
        },
      });

      expect(context.is_main_thread).toBeTrue();
      expect(context.compliance_state).toBe("restrained");
      expect(context.advisory).toBe(MAIN_THREAD_ADVISORY);
      expect(context.defect).toBeNull();
    });
  });

  describe("whoamiCommand structured execution", () => {
    it("should generate proper markdown and JSON output for worker agents", () => {
      const result = whoamiCommand({
        agent: "worker-3",
        pid: 1234,
        ppid: 1,
      });

      expect(result.pid).toBe(1234);
      expect(result.agent_id).toBe("worker-3");
      expect(result.tier).toBe(3);
      expect(result.compliance_state).toBe("compliant");

      const md = result.markdown as string;
      expect(md).toContain("### Thread Authority Identification (`whoami`)");
      expect(md).toContain("PID / PPID");
      expect(md).toContain("Active Agent");
      expect(md).toContain("Host App");
      expect(md).toContain("OS Platform");
      expect(md).toContain("Runtime");
      expect(md).toContain("Taxonomy");
      expect(md).toContain("COMPLIANT");

      const host = result.host_profile as HostProfile;
      expect(host.app_id).toBeDefined();
      expect(host.os_platform).toBeDefined();
    });

    it("surfaces run active grants and active leases when run capsule is provided", () => {
      const run = createWhoamiRun("grants-and-leases");
      registerTestGrant(run, "planner", "planner");
      transact(run, "test", "seed-lease", {}, (draft) => {
        draft.tasks = {
          "task-core": {
            id: "task-core",
            status: "claimed",
            lease: {
              agent_id: "planner",
              role: "planner",
              expires_at: "2026-08-19T01:00:00.000Z",
            },
          },
        };
      });

      const result = whoamiCommand({
        run,
        agent: "planner",
        pid: 4567,
        ppid: 1,
      });

      expect(result.run_root).toBe(run);
      expect(Array.isArray(result.active_grants)).toBeTrue();
      expect(Array.isArray(result.active_leases)).toBeTrue();
      expect(String(result.markdown)).toContain("Run Root");
      expect(String(result.markdown)).toContain("Active Grants");
      expect(String(result.markdown)).toContain("Active Leases");
    });

    it("supports explicit --role and --tier flags in whoamiCommand", () => {
      const orchResult = whoamiCommand({
        role: "orchestrator",
        pid: 5555,
      });
      expect(orchResult.role).toBe("orchestrator");
      expect(orchResult.tier).toBe(1);

      const coordResult = whoamiCommand({
        role: "coordinator",
        pid: 6666,
      });
      expect(coordResult.role).toBe("coordinator");
      expect(coordResult.tier).toBe(2);

      const mindResult = whoamiCommand({
        tier: "0",
        pid: 7777,
      });
      expect(mindResult.tier).toBe(0);
      expect(mindResult.role).toBe("mind");
    });
  });

  describe("whoami Next Actions are role and state aware", () => {
    it("tells an implementer holding a lease to heartbeat and submit that exact task", () => {
      const run = createWhoamiRun("lease-aware");
      registerTestGrant(run, "worker-1", "implementer");
      transact(run, "test", "seed-lease", {}, (draft) => {
        draft.tasks = {
          "task-core": {
            id: "task-core",
            status: "claimed",
            lease: {
              agent_id: "worker-1",
              role: "implementer",
              expires_at: "2026-08-19T01:00:00.000Z",
            },
          },
        };
      });

      const result = whoamiCommand({ run, agent: "worker-1" });
      const md = String(result.markdown);
      expect(md).toContain(
        `bun harness.ts task:heartbeat --run ${run} --task task-core --agent worker-1`,
      );
      expect(md).toContain(
        `bun harness.ts task:submit --run ${run} --task task-core --agent worker-1`,
      );
      expect(md).not.toContain("agent:register");
    });

    it("tells an unregistered agent to agent:register with its exact declared role", () => {
      const run = createWhoamiRun("no-grant");

      const result = whoamiCommand({ run, agent: "nobody-1", role: "implementer" });
      const md = String(result.markdown);
      expect(md).toContain(
        `bun harness.ts agent:register --run ${run} --agent nobody-1 --role implementer --host <HOST>`,
      );
      expect(md).not.toContain("task:heartbeat");
    });

    it("tells a validator holding an open validation to probe and review that exact task", () => {
      const run = createWhoamiRun("validator-aware");
      const validatorId = "val-inspector-1";
      const taskId = "task-validate-01";
      registerTestGrant(run, validatorId, "validator");
      transact(run, "test", "seed-validation", {}, (draft) => {
        draft.tasks = {
          [taskId]: {
            id: taskId,
            status: "validating",
            validations: [
              {
                validator_id: validatorId,
                domain: "code-quality",
                deadline_at: "2026-08-19T01:00:00.000Z",
              },
            ],
          },
        };
      });

      const result = whoamiCommand({ run, agent: validatorId });
      const md = String(result.markdown);
      expect(md).toContain(
        `bun harness.ts task:probe --run ${run} --task ${taskId} --validator ${validatorId}`,
      );
      expect(md).toContain(
        `bun harness.ts task:review --run ${run} --task ${taskId} --validator ${validatorId}`,
      );
      expect(md).not.toContain("agent:register");
    });

    it("handles non-existent virtual run path gracefully without crashing", () => {
      const nonExistentRun = "/virtual/agents-scratch/nonexistent-run-capsule";
      const result = whoamiCommand({
        run: nonExistentRun,
        agent: "worker-isolated",
        pid: 8888,
      });

      expect(result.pid).toBe(8888);
      expect(result.agent_id).toBe("worker-isolated");
      expect(result.active_grants).toEqual([]);
      expect(result.active_leases).toEqual([]);
      expect(String(result.markdown)).toContain("Thread Authority Identification");
    });

    it("filters next-action suggestions to only recommend tasks leased to the active agent", () => {
      const run = createWhoamiRun("multi-agent-leases");
      registerTestGrant(run, "worker-1", "implementer");
      transact(run, "test", "seed-multi-leases", {}, (draft) => {
        draft.tasks = {
          "task-worker-1": {
            id: "task-worker-1",
            status: "claimed",
            lease: {
              agent_id: "worker-1",
              role: "implementer",
              expires_at: "2026-08-19T01:00:00.000Z",
            },
          },
          "task-worker-2": {
            id: "task-worker-2",
            status: "claimed",
            lease: {
              agent_id: "worker-2",
              role: "implementer",
              expires_at: "2026-08-19T01:00:00.000Z",
            },
          },
        };
      });

      const result = whoamiCommand({ run, agent: "worker-1" });
      const md = String(result.markdown);
      expect(md).toContain(
        "task:heartbeat --run " + run + " --task task-worker-1 --agent worker-1",
      );
      expect(md).toContain("task:submit --run " + run + " --task task-worker-1 --agent worker-1");
      expect(md).not.toContain("task-worker-2");
    });
  });
});
