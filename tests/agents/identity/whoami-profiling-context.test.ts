import { describe, it, expect, afterEach } from "bun:test";
import {
  identifyExecutionContext,
  detectHostApp,
  buildCapabilitiesProfile,
  parseTierValue,
  roleToTier,
  agentIdToTier,
  agentIdToRole,
  MAIN_THREAD_ADVISORY,
  type HostProfile,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami";
import { taskClaimCommand } from "../../../olt/scripts/src/cli/commands/task-ops.ts";
import { cleanupRoots } from "../../cli/full-lifecycle-fixture";
import { setupCompiledRun } from "../../cli/task-ops-fixture";
import { TASK_ID, VALIDATOR, claimSubmitValidate, setupRun } from "../../cli/probe-fixture";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

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

    it("surfaces run active grants and active leases when run capsule is provided", async () => {
      const { run } = await setupCompiledRun("whoami-profiling-run", roots);

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
    it("tells an implementer holding a lease to heartbeat and submit that exact task", async () => {
      const { run } = await setupCompiledRun("whoami-lease-aware", roots);
      const claim = await taskClaimCommand({
        run,
        task: "task-core",
        agent: "worker-1",
        role: "implementer",
      });
      expect(claim.token).toBeDefined();

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

    it("tells an unregistered agent to agent:register with its exact declared role", async () => {
      const { run } = await setupCompiledRun("whoami-no-grant", roots);

      const result = whoamiCommand({ run, agent: "nobody-1", role: "implementer" });
      const md = String(result.markdown);
      expect(md).toContain(
        `bun harness.ts agent:register --run ${run} --agent nobody-1 --role implementer --host <HOST>`,
      );
      expect(md).not.toContain("task:heartbeat");
    });

    it("tells a validator holding an open validation to probe and review that exact task", async () => {
      const { repo, run } = await setupRun("whoami-validator-aware", roots);
      await claimSubmitValidate(repo, run);

      const result = whoamiCommand({ run, agent: VALIDATOR });
      const md = String(result.markdown);
      expect(md).toContain(
        `bun harness.ts task:probe --run ${run} --task ${TASK_ID} --validator ${VALIDATOR}`,
      );
      expect(md).toContain(
        `bun harness.ts task:review --run ${run} --task ${TASK_ID} --validator ${VALIDATOR}`,
      );
      expect(md).not.toContain("agent:register");
    });
  });
});
