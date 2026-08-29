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
} from "../../../olt/scripts/src/authority/thread-identifier";
import { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami";
import { taskClaimCommand } from "../../../olt/scripts/src/cli/commands/task-ops.ts";
import { cleanupRoots } from "../cli/full-lifecycle-fixture";
import { setupCompiledRun } from "../cli/task-ops-fixture";
import { TASK_ID, VALIDATOR, claimSubmitValidate, setupRun } from "../cli/probe-fixture";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Agent Whoami Profiling Engine", () => {
  describe("detectHostApp", () => {
    it("should detect Claude Code", () => {
      expect(detectHostApp({ ["CLAUDE" + "_CLI"]: "1" })).toBe("Claude Code");
      expect(detectHostApp({ CLAUDE_CODE_VERSION: "1.0.0" })).toBe("Claude Code");
    });

    it("should detect Antigravity / Gemini CLI", () => {
      expect(detectHostApp({ ["ANTIGRAVITY" + "_CLI"]: "1" })).toBe("Antigravity/Gemini CLI");
      expect(detectHostApp({ GEMINI_CLI: "1" })).toBe("Antigravity/Gemini CLI");
      expect(detectHostApp({ ANTIGRAVITY_VERSION: "2.0.0" })).toBe("Antigravity/Gemini CLI");
    });

    it("should detect Cursor", () => {
      expect(detectHostApp({ TERM_PROGRAM: "cursor" })).toBe("Cursor");
      expect(detectHostApp({ CURSOR_VERSION: "0.40.0" })).toBe("Cursor");
    });

    it("should detect VSCode", () => {
      expect(detectHostApp({ TERM_PROGRAM: "vscode" })).toBe("VSCode Terminal");
    });

    it("should detect OpenCode", () => {
      expect(detectHostApp({ OPENCODE_CLI: "1" })).toBe("OpenCode");
    });

    it("should detect Codex", () => {
      expect(detectHostApp({ CODEX_CLI: "1" })).toBe("Codex");
    });

    it("should default to Generic Host", () => {
      expect(detectHostApp({})).toBe("Generic Host");
    });
  });

  describe("buildCapabilitiesProfile", () => {
    it("should set taxonomy based on tier", () => {
      expect(buildCapabilitiesProfile(0, {}).command_taxonomy).toBe("Full Root / All Permissions");
      expect(buildCapabilitiesProfile(1, {}).command_taxonomy).toBe(
        "Orchestration / Delegation Only",
      );
      expect(buildCapabilitiesProfile(2, {}).command_taxonomy).toBe("Coordination / Dispatch Only");
      expect(buildCapabilitiesProfile(3, {}).command_taxonomy).toBe("Implementation / Execution");
    });

    it("should parse tools and grants from environment", () => {
      const capabilities = buildCapabilitiesProfile(3, {
        GRANTED_TOOLS: "bash, bun, git",
        ENVIRONMENT_GRANTS: "READ_ONLY, WORKTREE_ISOLATION",
      });
      expect(capabilities.tools).toEqual(["bash", "bun", "git"]);
      expect(capabilities.environment_grants).toEqual(["READ_ONLY", "WORKTREE_ISOLATION"]);
    });

    it("should handle empty tool and grant environments gracefully", () => {
      const capabilities = buildCapabilitiesProfile(1, {});
      expect(capabilities.tools).toEqual([]);
      expect(capabilities.environment_grants).toEqual([]);
    });
  });

  describe("Tier and Role Parsing", () => {
    it("should parse tier values accurately", () => {
      expect(parseTierValue("0")).toBe(0);
      expect(parseTierValue("tier-0")).toBe(0);
      expect(parseTierValue("human")).toBe(0);
      expect(parseTierValue("mind")).toBe(0);

      expect(parseTierValue("1")).toBe(1);
      expect(parseTierValue("tier-1")).toBe(1);
      expect(parseTierValue("orchestrator")).toBe(1);
      expect(parseTierValue("mind-auditor")).toBe(1);

      expect(parseTierValue("2")).toBe(2);
      expect(parseTierValue("tier-2")).toBe(2);
      expect(parseTierValue("coordinator")).toBe(2);

      expect(parseTierValue("3")).toBe(3);
      expect(parseTierValue("tier-3")).toBe(3);
      expect(parseTierValue("implementer")).toBe(3);
      expect(parseTierValue("validator")).toBe(3);
      expect(parseTierValue("critic")).toBe(3);
      expect(parseTierValue("repairer")).toBe(3);

      expect(parseTierValue("unknown-tier")).toBeNull();
      expect(parseTierValue(undefined)).toBeNull();
    });

    it("should map roles to execution tiers", () => {
      expect(roleToTier("mind")).toBe(0);
      expect(roleToTier("orchestrator")).toBe(1);
      expect(roleToTier("orch-pulse")).toBe(1);
      expect(roleToTier("mind-auditor")).toBe(1);
      expect(roleToTier("coordinator")).toBe(2);
      expect(roleToTier("coord-domain-backend")).toBe(2);
      expect(roleToTier("implementer")).toBe(3);
      expect(roleToTier("validator")).toBe(3);
      expect(roleToTier("completeness-critic")).toBe(3);
      expect(roleToTier("repairer")).toBe(3);
    });

    it("should map agent IDs to tiers and roles", () => {
      expect(agentIdToTier("mind-supervisor")).toBe(0);
      expect(agentIdToRole("mind-supervisor")).toBe("mind");

      expect(agentIdToTier("orch-master")).toBe(1);
      expect(agentIdToRole("orch-master")).toBe("orchestrator");

      expect(agentIdToTier("audit-verifier")).toBe(1);
      expect(agentIdToRole("audit-verifier")).toBe("mind-auditor");

      expect(agentIdToTier("coord-lead")).toBe(2);
      expect(agentIdToRole("coord-lead")).toBe("coordinator");

      expect(agentIdToTier("impl-unit-test")).toBe(3);
      expect(agentIdToRole("impl-unit-test")).toBe("implementer");

      expect(agentIdToTier("val-security")).toBe(3);
      expect(agentIdToRole("val-security")).toBe("validator");

      expect(agentIdToTier("critic-gate")).toBe(3);
      expect(agentIdToRole("critic-gate")).toBe("completeness-critic");

      expect(agentIdToTier("repairer-patch")).toBe(3);
      expect(agentIdToRole("repairer-patch")).toBe("repairer");

      expect(agentIdToTier("planner-graph")).toBe(3);
      expect(agentIdToRole("planner-graph")).toBe("planner");
    });
  });

  describe("Tier Self-Identification across all Agent Startup Roles", () => {
    it("identifies Tier 0 Mind supervisor on startup", () => {
      const context = identifyExecutionContext({
        agentId: "mind-supervisor",
        role: "mind",
        env: {
          HARNESS_EXECUTION_TIER: "0",
          HOST_SUBAGENT: "1",
        },
      });

      expect(context.tier).toBe(0);
      expect(context.role).toBe("mind");
      expect(context.agent_id).toBe("mind-supervisor");
      expect(context.compliance_state).toBe("compliant");
      expect(context.capabilities.command_taxonomy).toBe("Full Root / All Permissions");
    });

    it("identifies Tier 1 Orchestrator on startup", () => {
      const context = identifyExecutionContext({
        agentId: "orch-pulse-1",
        role: "orchestrator",
        env: {
          HARNESS_EXECUTION_TIER: "1",
          HOST_SUBAGENT: "1",
        },
      });

      expect(context.tier).toBe(1);
      expect(context.role).toBe("orchestrator");
      expect(context.agent_id).toBe("orch-pulse-1");
      expect(context.compliance_state).toBe("compliant");
      expect(context.capabilities.command_taxonomy).toBe("Orchestration / Delegation Only");
    });

    it("identifies Tier 2 Background Coordinator on startup", () => {
      const context = identifyExecutionContext({
        agentId: "coord-wave-1",
        role: "coordinator",
        env: {
          HARNESS_EXECUTION_TIER: "2",
          HOST_SUBAGENT: "1",
        },
      });

      expect(context.tier).toBe(2);
      expect(context.role).toBe("coordinator");
      expect(context.agent_id).toBe("coord-wave-1");
      expect(context.compliance_state).toBe("compliant");
      expect(context.capabilities.command_taxonomy).toBe("Coordination / Dispatch Only");
    });

    it("identifies Tier 3 Implementer on startup", () => {
      const context = identifyExecutionContext({
        agentId: "impl-coder",
        role: "implementer",
        env: {
          HARNESS_EXECUTION_TIER: "3",
          HOST_SUBAGENT: "1",
        },
      });

      expect(context.tier).toBe(3);
      expect(context.role).toBe("implementer");
      expect(context.agent_id).toBe("impl-coder");
      expect(context.compliance_state).toBe("compliant");
      expect(context.capabilities.command_taxonomy).toBe("Implementation / Execution");
    });

    it("identifies Tier 3 Validator on startup", () => {
      const context = identifyExecutionContext({
        agentId: "val-inspector",
        role: "validator",
        env: {
          HARNESS_EXECUTION_TIER: "3",
          HOST_SUBAGENT: "1",
        },
      });

      expect(context.tier).toBe(3);
      expect(context.role).toBe("validator");
      expect(context.agent_id).toBe("val-inspector");
      expect(context.compliance_state).toBe("compliant");
      expect(context.capabilities.command_taxonomy).toBe("Implementation / Execution");
    });
  });

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
